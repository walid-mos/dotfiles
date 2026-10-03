import { randomUUID } from 'node:crypto'
import { mkdtemp, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { truncateHead, truncateTail } from '@earendil-works/pi-coding-agent'

import {
	JOB_COMMAND_BYTES,
	JOB_PREVIEW_BYTES,
	JOB_PREVIEW_LINES,
} from './bash-job-schema.ts'

import type {
	AgentToolResult,
	AgentToolUpdateCallback,
	BashToolDetails,
} from '@earendil-works/pi-coding-agent'
import type { JobSnapshot } from './bash-job-schema.ts'

export type BashExecutionResult = AgentToolResult<BashToolDetails | undefined>
export type BashExecution = (
	signal: AbortSignal,
	update: AgentToolUpdateCallback<BashToolDetails | undefined>,
) => Promise<BashExecutionResult>

export interface BashJobOptions {
	command: string
	cwd: string
	execute: BashExecution
	update: AgentToolUpdateCallback<BashToolDetails | undefined> | undefined
	onComplete: (job: BashJob) => void
}

/** Owns one execution and its receipt. Promotion never starts a second process. */
export class BashJob {
	readonly id = randomUUID()
	readonly completion: Promise<void>
	readonly #controller = new AbortController()
	readonly #settled = new AbortController()
	readonly settled = this.#settled.signal
	readonly #snapshot: JobSnapshot
	#result: BashExecutionResult = { content: [], details: undefined }
	#isBackground = false
	#saveQueue: Promise<void> = Promise.resolve()

	constructor(options: BashJobOptions) {
		this.#snapshot = {
			jobId: this.id,
			command: options.command,
			cwd: options.cwd,
			status: 'running',
			startedAt: Date.now(),
		}
		this.completion = this.#finish(options)
	}

	async #finish(options: BashJobOptions): Promise<void> {
		await this.#execute(options.execute, options.update)
		this.#settled.abort()
		if (!this.#isBackground) return
		try {
			options.onComplete(this)
		} catch (cause) {
			this.#snapshot.notificationError =
				cause instanceof Error ? cause.message : String(cause)
		}
		await this.save()
	}

	async #execute(
		execute: BashExecution,
		update:
			| AgentToolUpdateCallback<BashToolDetails | undefined>
			| undefined,
	): Promise<void> {
		try {
			this.#result = await execute(this.#controller.signal, output => {
				this.#result = output
				if (!this.#isBackground) update?.(output)
			})
			this.#snapshot.status = this.#result.isError
				? 'failed'
				: 'completed'
		} catch (cause) {
			const text = cause instanceof Error ? cause.message : String(cause)
			this.#result = {
				content: [{ type: 'text', text }],
				details: this.#result.details,
				isError: true,
			}
			this.#snapshot.status = 'failed'
		}
		if (this.#controller.signal.aborted) {
			this.#snapshot.status = 'cancelled'
			this.#result = {
				...this.#result,
				isError: true,
				content: [
					...this.#result.content,
					{ type: 'text', text: 'Command cancelled.' },
				],
			}
		}
		this.#snapshot.finishedAt = Date.now()
	}

	isRunning(): boolean {
		return !this.#snapshot.finishedAt
	}

	isBackground(): boolean {
		return this.#isBackground
	}

	promote(): void {
		this.#isBackground = true
		void this.save()
	}

	stop(): void {
		if (!this.isRunning()) return
		this.#snapshot.status = 'stopping'
		this.#controller.abort()
	}

	snapshot(): JobSnapshot {
		const snapshot = {
			...this.#snapshot,
			command: truncateHead(this.#snapshot.command, {
				maxBytes: JOB_COMMAND_BYTES,
			}).content,
		}
		const fullOutputPath = this.#result.details?.fullOutputPath
		if (fullOutputPath) return { ...snapshot, fullOutputPath }
		return snapshot
	}

	result(): BashExecutionResult {
		return this.#result
	}

	preview(): string {
		const output = this.#result.content
			.flatMap(part => (part.type === 'text' ? [part.text] : []))
			.join('\n')
		return truncateTail(output, {
			maxBytes: JOB_PREVIEW_BYTES,
			maxLines: JOB_PREVIEW_LINES,
		}).content
	}

	/** Serialize two writes only: promotion and completion. */
	save(): Promise<void> {
		this.#saveQueue = this.#persistAfter(this.#saveQueue)
		return this.#saveQueue
	}

	async #persistAfter(previous: Promise<void>): Promise<void> {
		await previous
		try {
			this.#snapshot.receiptPath ??= join(
				await mkdtemp(join(tmpdir(), 'pi-bash-job-')),
				'result.json',
			)
			const path = this.#snapshot.receiptPath
			await writeFile(
				`${path}.tmp`,
				JSON.stringify({
					...this.snapshot(),
					command: this.#snapshot.command,
					result: this.#result,
				}),
				{ mode: 0o600 },
			)
			await rename(`${path}.tmp`, path)
		} catch (cause) {
			this.#snapshot.persistenceError =
				cause instanceof Error ? cause.message : String(cause)
		}
	}
}
