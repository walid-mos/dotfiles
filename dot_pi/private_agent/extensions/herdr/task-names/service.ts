/** Runs inside Pi. A single owner writes names; other panes wait to take over. */
import { POLL_MS } from './contracts.ts'
import { refreshNames } from './coordinator.ts'
import { acquireNaming } from './ownership.ts'
import { loadState } from './storage.ts'

import type { ModelRegistry } from '@earendil-works/pi-coding-agent'
import type { NamingOwnership } from './ownership.ts'

const ERROR_RETRY_MS = 60_000

export function startNaming(
	runtime: ModelRegistry,
	notify: (message: string) => void,
): () => Promise<void> {
	const controller = new AbortController()
	let owner: NamingOwnership | undefined
	let inFlight: Promise<void> | undefined
	let retryAt = 0
	let lastError = ''
	async function refresh(): Promise<void> {
		try {
			owner ??= await acquireNaming()
			if (!owner || controller.signal.aborted) return
			await refreshNames(runtime, await loadState(), controller.signal)
			lastError = ''
		} catch (cause) {
			if (controller.signal.aborted) return
			retryAt = Date.now() + ERROR_RETRY_MS
			const message = `Herdr task naming: ${String(cause)}`
			if (message !== lastError) notify(message)
			lastError = message
		} finally {
			inFlight = undefined
		}
	}
	function schedule(): void {
		if (inFlight || controller.signal.aborted || Date.now() < retryAt)
			return
		inFlight = refresh()
	}
	const timer = setInterval(schedule, POLL_MS)
	timer.unref()
	schedule()
	return async () => {
		clearInterval(timer)
		controller.abort()
		await inFlight
		const released = owner
		owner = undefined
		await released?.release()
	}
}
