/**
 * The settle watcher: /simplify sends its own user messages, so it has to know
 * when the run each one started has finished. A command handler cannot assume
 * anything about that ordering, but pi says it directly at `agent_settled` -
 * the first moment it will not continue on its own.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

/** A dispatched run that never settles must not hang the command forever. */
export const TURN_TIMEOUT_MS = 1_800_000

export type TurnOutcome = 'settled' | 'timeout'

export interface TurnWatcher {
	/** Arm the watcher, dispatch the message, and wait for that run to settle. */
	run(dispatch: () => void): Promise<TurnOutcome>
	dispose(): void
}

interface PendingTurn {
	resolve: (outcome: TurnOutcome) => void
	timer: ReturnType<typeof setTimeout>
}

export function createTurnWatcher(pi: ExtensionAPI): TurnWatcher {
	let pending: PendingTurn | undefined
	const release = (outcome: TurnOutcome): void => {
		const current = pending
		if (!current) return
		pending = undefined
		clearTimeout(current.timer)
		current.resolve(outcome)
	}
	pi.on('agent_settled', () => release('settled'))
	return {
		run: dispatch =>
			new Promise<TurnOutcome>(resolve => {
				// Arming before the dispatch is what makes the signal unambiguous.
				const timer = setTimeout(
					() => release('timeout'),
					TURN_TIMEOUT_MS,
				)
				pending = { resolve, timer }
				dispatch()
			}),
		dispose: () => release('timeout'),
	}
}
