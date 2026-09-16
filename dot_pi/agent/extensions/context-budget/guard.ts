/**
 * context-budget - the guard state machine: one decision per turn, no IO.
 *
 * `next()` receives the prompt size pi reports and returns the single action
 * the caller must take (set a status, announce, ask for a handoff, or do
 * nothing). All pi and filesystem access is injected, so the transitions -
 * warn once, ask twice at most, stop once the handoff exists - are unit-tested
 * in `../tests/context-budget.test.ts` without a session.
 */

import {
	MAX_SETTLE_RETRIES,
	budgetLevel,
	handoffDirective,
	shouldNudge,
	statusText,
} from './budget.ts'
import { handoffPath } from './handoff.ts'

import type { Ceiling } from './budget.ts'

/** Shown once the requested handoff exists. */
export const HANDOFF_READY = 'handoff ready'

/**
 * What the caller should do after a check:
 * - `clear`   - below the ceiling (or disabled): drop the status
 * - `status`  - over the warning mark, already announced: just show the size
 * - `warn`    - first crossing of the warning mark: announce it once
 * - `handoff` - at the ceiling: announce and ask the agent for a handoff
 * - `ready`   - the handoff exists: report readiness and stop guarding
 */
export type GuardAction =
	| { type: 'clear' }
	| { type: 'status'; status: string }
	| { type: 'warn'; status: string; tokens: number; ceiling: number }
	| {
			type: 'handoff'
			status: string
			path: string
			tokens: number
			ceiling: number
	  }
	| { type: 'ready'; status: string }

export type GuardOptions = {
	agentDir: string
	/** Whether an earlier handoff request already produced a usable file. */
	isWritten: (path: string) => boolean
}

/**
 * What the caller should do once the agent has settled (idle, nothing left for
 * pi to run on its own):
 * - `idle`    - no handoff was requested in this session
 * - `compact` - the requested handoff exists: replace the conversation with it
 * - `reask`   - requested but missing, retries left: steer the request again
 * - `givenUp` - requested, missing, retries spent: report it and stop
 */
export type SettleAction =
	| { type: 'idle' }
	| { type: 'compact'; path: string }
	| { type: 'reask'; path: string; ceiling: number; retry: number }
	| { type: 'givenUp'; path: string }

export class ContextGuard {
	private readonly options: GuardOptions
	private ceiling: Ceiling = 'off'
	private nudges = 0
	private settleRetries = 0
	private hasWarned = false
	private requestedPath: string | undefined

	constructor(options: GuardOptions) {
		this.options = options
	}

	/** Ceiling currently in force; `off` means the guard stays silent. */
	enable(ceiling: Ceiling): void {
		this.ceiling = ceiling
		this.nudges = 0
		this.settleRetries = 0
		this.hasWarned = false
		this.requestedPath = undefined
	}

	/** Path this session's last handoff request asked for, if any. */
	get handoffFile(): string | undefined {
		return this.requestedPath
	}

	/** Ceiling in force; `off` means no guard. */
	currentCeiling(): Ceiling {
		return this.ceiling
	}

	next(tokens: number, sessionId: string, at: Date): GuardAction {
		const { ceiling } = this
		if (ceiling === 'off') return { type: 'clear' }

		// A written handoff ends the guard's job for this session: report
		// readiness, whatever the prompt size does next.
		if (this.requestedPath && this.options.isWritten(this.requestedPath)) {
			return { type: 'ready', status: HANDOFF_READY }
		}

		const level = budgetLevel(tokens, ceiling)
		if (level === 'ok') return { type: 'clear' }
		const status = statusText(tokens, ceiling)
		if (level === 'warn') {
			if (this.hasWarned) return { type: 'status', status }
			this.hasWarned = true
			return { type: 'warn', status, tokens, ceiling }
		}
		if (!shouldNudge(tokens, ceiling, this.nudges)) {
			return { type: 'status', status }
		}
		this.nudges += 1
		this.requestedPath = handoffPath(this.options.agentDir, sessionId, at)
		return {
			type: 'handoff',
			status,
			path: this.requestedPath,
			tokens,
			ceiling,
		}
	}

	/**
	 * Decision for a settled agent, i.e. the moment pi will not continue on its
	 * own. The chain must not wait for a human here: compact from the handoff as
	 * soon as it exists, re-ask while it is missing, then report and stop.
	 */
	settled(): SettleAction {
		const path = this.requestedPath
		if (!path) return { type: 'idle' }
		if (this.options.isWritten(path)) return { type: 'compact', path }
		const { ceiling } = this
		if (ceiling === 'off') return { type: 'idle' }
		if (this.settleRetries >= MAX_SETTLE_RETRIES) {
			return { type: 'givenUp', path }
		}
		this.settleRetries += 1
		return { type: 'reask', path, ceiling, retry: this.settleRetries }
	}
}

/** The parts of a handoff request the directive needs. */
export type HandoffRequest = {
	ceiling: number
	path: string
	/** Set when this is a settle re-ask rather than the first request. */
	retry?: number
}

/** The text steered into the turn for a `handoff` action, or a settle re-ask. */
export function handoffMessage(
	request: HandoffRequest,
	body: string | undefined,
): string {
	return handoffDirective({
		ceiling: request.ceiling,
		path: request.path,
		body,
		retry: request.retry ?? 0,
	})
}
