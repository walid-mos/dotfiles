/** Polling never waits for model naming. Both jobs stop before releasing ownership. */
import { POLL_MS } from './contracts.ts'
import { refreshNames } from './coordinator.ts'
import { acquireNaming } from './ownership.ts'
import { loadState } from './storage.ts'
import { logNamingFailure, summarize } from './summarize.ts'

import type { ModelRegistry } from '@earendil-works/pi-coding-agent'
import type { NamedPlan, NamingPlan } from './coordinator.ts'
import type { NamingOwnership } from './ownership.ts'

const ERROR_RETRY_MS = 60_000

type NamingRequest = {
	fingerprint: string
	controller: AbortController
	promise: Promise<void>
}

class TitleGeneration {
	private request: NamingRequest | undefined
	private completed: NamedPlan | undefined
	private retryAt = 0
	private retryFingerprint = ''
	private readonly runtime: ModelRegistry
	private readonly onFailure: (message: string) => void

	constructor(runtime: ModelRegistry, onFailure: (message: string) => void) {
		this.runtime = runtime
		this.onFailure = onFailure
	}

	consume(): NamedPlan | undefined {
		const { completed } = this
		this.completed = undefined
		return completed
	}

	update(plan: NamingPlan | undefined): void {
		if (this.request && this.request.fingerprint !== plan?.fingerprint)
			this.request.controller.abort()
		if (!plan || this.request) return
		if (
			plan.fingerprint === this.retryFingerprint &&
			Date.now() < this.retryAt
		)
			return
		const controller = new AbortController()
		this.request = {
			fingerprint: plan.fingerprint,
			controller,
			promise: this.generate(plan, controller.signal),
		}
	}

	private async generate(
		plan: NamingPlan,
		signal: AbortSignal,
	): Promise<void> {
		try {
			const titles = await summarize(
				this.runtime,
				plan.input,
				plan.retained,
				signal,
			)
			signal.throwIfAborted()
			this.completed = {
				fingerprint: plan.fingerprint,
				keys: plan.keys,
				titles,
			}
			this.retryFingerprint = ''
		} catch (cause) {
			if (signal.aborted) return
			this.retryAt = Date.now() + ERROR_RETRY_MS
			this.retryFingerprint = plan.fingerprint
			this.onFailure(
				`Title model failed; current task labels remain visible: ${String(cause)}`,
			)
		} finally {
			this.request = undefined
		}
	}

	async stop(): Promise<void> {
		this.request?.controller.abort()
		await this.request?.promise
	}
}

async function saveFailure(
	message: string,
	notify: (message: string) => void,
): Promise<void> {
	try {
		await logNamingFailure(message)
	} catch (cause) {
		notify(`Cannot save Herdr naming diagnostics: ${String(cause)}`)
	}
}

class NamingService {
	private readonly controller = new AbortController()
	private readonly reported = new Set<string>()
	private readonly generation: TitleGeneration
	private readonly notify: (message: string) => void
	private readonly timer: ReturnType<typeof setInterval>
	private owner: NamingOwnership | undefined
	private inFlight: Promise<void> | undefined

	constructor(runtime: ModelRegistry, notify: (message: string) => void) {
		this.notify = notify
		this.generation = new TitleGeneration(runtime, message =>
			this.reportFailure(message),
		)
		this.timer = setInterval(() => this.schedule(), POLL_MS)
		this.timer.unref()
		this.schedule()
	}

	private reportFailure(message: string): void {
		if (this.reported.has(message) || this.controller.signal.aborted) return
		this.reported.add(message)
		this.notify(`Herdr task naming: ${message}`)
		void saveFailure(message, this.notify)
	}

	private async refresh(): Promise<void> {
		try {
			this.owner ??= await acquireNaming()
			if (!this.owner || this.controller.signal.aborted) return
			const state = await loadState()
			const plan = await refreshNames(
				state,
				this.generation.consume(),
				message => this.reportFailure(message),
			)
			if (!this.controller.signal.aborted) this.generation.update(plan)
		} catch (cause) {
			this.reportFailure(String(cause))
		} finally {
			this.inFlight = undefined
		}
	}

	private schedule(): void {
		if (!this.inFlight && !this.controller.signal.aborted)
			this.inFlight = this.refresh()
	}

	async stop(): Promise<void> {
		clearInterval(this.timer)
		this.controller.abort()
		await Promise.all([this.inFlight, this.generation.stop()])
		await this.owner?.release()
		this.owner = undefined
	}
}

export function startNaming(
	runtime: ModelRegistry,
	notify: (message: string) => void,
): () => Promise<void> {
	const service = new NamingService(runtime, notify)
	return () => service.stop()
}
