/**
 * context-budget - the guard state machine: one decision per turn, no IO.
 *
 * `next()` receives the prompt size pi reports and returns the single action
 * the caller must take (set a status, announce a mark, or ask for the
 * handoff). In the runway band below the ceiling the ask waits for the settle
 * boundary, where ending the run costs no interrupted work; past the ceiling it
 * stops waiting, because the margin the runway reserved is already spent and a
 * busy agent has no reason to settle soon. Once a request is out, the settle
 * boundary owns the rest of the cycle: compact from the file, re-ask while it
 * is missing, report when the retries run out. All pi and filesystem access is
 * injected, so the transitions are unit-tested in `../tests/context-budget.test.ts`
 * without a session.
 */

import {
	MAX_SETTLE_RETRIES,
	budgetLevel,
	capForObservedLimit,
	clampCeiling,
	handoffDirective,
	statusText,
} from './budget.ts'
import { handoffPath } from './handoff.ts'

import type { Ceiling } from './budget.ts'

/** Shown once the requested handoff exists. */
export const HANDOFF_READY = 'handoff ready'

/**
 * What the caller should do after a turn-end check:
 * - `clear`   - below the ceiling (or disabled): drop the status
 * - `status`  - over the warning mark, already announced: just show the size
 * - `warn`    - first crossing of the warning mark: announce it once
 * - `pending` - in the runway band below the ceiling: announce that the ask
 *               goes out at the settle, and let the run finish
 * - `handoff` - past the ceiling: the run has spent the runway on its own work,
 *               so the request stops waiting for the settle
 * - `ready`   - the handoff exists: report readiness and stop guarding
 */
export type GuardAction =
	| { type: 'clear' }
	| { type: 'status'; status: string }
	| { type: 'warn'; status: string; tokens: number; ceiling: number }
	| { type: 'pending'; status: string; tokens: number; ceiling: number }
	| {
			type: 'handoff'
			status: string
			path: string
			tokens: number
			ceiling: number
	  }
	| { type: 'ready'; status: string }

/**
 * What the caller should do once the agent has settled (idle, nothing left for
 * pi to run on its own):
 * - `idle`    - nothing to do: no outstanding request
 * - `handoff` - the ceiling was crossed too late for a request to go out: ask
 *               for the handoff now, before another turn is spent
 * - `compact` - the requested handoff exists: replace the conversation with it
 * - `reask`   - requested but not usable, retries left: steer the request again
 * - `givenUp` - requested, not usable, retries spent: report it and stop
 */
export type SettleAction =
	| { type: 'idle' }
	| { type: 'handoff'; path: string; ceiling: number }
	| { type: 'compact'; path: string }
	| { type: 'reask'; path: string; ceiling: number; retry: number }
	| { type: 'givenUp'; path: string }

export type GuardOptions = {
	agentDir: string
	/** Whether an earlier handoff request already produced a usable file. */
	isWritten: (path: string) => boolean
}

export class ContextGuard {
	private readonly options: GuardOptions
	private ceiling: Ceiling = 'off'
	private sessionId: string | undefined
	private hasWarned = false
	/** The runway band was entered; the settle boundary still owns the ask. */
	private pending = false
	/** The retries for this cycle's handoff are spent: reported, not repeated. */
	private givenUp = false
	/** The first reading after this extension's own compaction is stale. */
	private awaitingFreshReading = false
	private settleRetries = 0
	/** Failed `compact` attempts for the current handoff, bounding the retry. */
	private compactFailures = 0
	/** The ceiling as clamped by the model's window, once known. */
	private effectiveCeiling: number | undefined
	private requestedPath: string | undefined
	/**
	 * Context size at which a provider refused a request, in tokens. Not reset
	 * by `enable()`: the limit is a property of the model and the provider, not
	 * of this ceiling, and a later cycle that forgets it walks into the same
	 * refusal.
	 */
	private overflowAt: number | undefined

	constructor(options: GuardOptions) {
		this.options = options
	}

	/** Ceiling currently in force; `off` means the guard stays silent. */
	enable(ceiling: Ceiling): void {
		this.ceiling = ceiling
		this.hasWarned = false
		this.pending = false
		this.awaitingFreshReading = false
		this.settleRetries = 0
		this.compactFailures = 0
		this.givenUp = false
		this.effectiveCeiling = undefined
		this.requestedPath = undefined
	}

	/**
	 * A provider refused a request of this size: the real limit of the model is
	 * at or below it. Whatever the window claims, the ceiling must fit under
	 * what the API actually accepts, or every ask for a handoff lands past the
	 * limit and dies with the turn pi aborts (observed 2026-09-19: the declared
	 * 1,000,000-token window against a refusal at 180,824).
	 */
	noteOverflow(tokensBefore: number): void {
		if (!Number.isFinite(tokensBefore) || tokensBefore <= 0) return
		this.overflowAt = this.overflowAt
			? Math.min(this.overflowAt, tokensBefore)
			: tokensBefore
	}

	/**
	 * The ceiling this session may use: the configured one, held under the
	 * model's window and under any limit a refusal has revealed.
	 */
	private ceilingFor(ceiling: number, windowTokens?: number): number {
		return clampCeiling(
			capForObservedLimit(ceiling, this.overflowAt),
			windowTokens,
		)
	}

	/**
	 * Skip the first numeric reading after this extension's own compaction.
	 * pi reports null until an assistant answers past the boundary, but the
	 * continuation this extension sends from `onComplete` can race the
	 * compaction being applied: its request is then still built from the
	 * pre-compaction context, and its usage comes back numeric and huge.
	 * That race is not hypothetical - it is the double handoff observed 20
	 * times in the handoff corpus (2026-09-17, sessions 01a0b09d et al).
	 * Skipping one reading delays detection by a turn; acting on it costs a
	 * second handoff per cycle.
	 */
	noteCompacted(): void {
		this.awaitingFreshReading = true
	}

	/**
	 * The compaction from the handoff failed: bound the retries the same way
	 * the re-asks are bounded, so a permanently failing compaction cannot be
	 * attempted on every settle forever.
	 */
	noteCompactFailed(): void {
		this.compactFailures += 1
	}

	/** Path this session's last handoff request asked for, if any. */
	get handoffFile(): string | undefined {
		return this.requestedPath
	}

	/** Ceiling in force; `off` means no guard. */
	currentCeiling(): Ceiling {
		return this.ceiling
	}

	next(
		tokens: number,
		sessionId: string,
		at: Date,
		windowTokens?: number,
	): GuardAction {
		this.sessionId = sessionId
		const { ceiling } = this
		if (ceiling === 'off') return { type: 'clear' }

		if (this.awaitingFreshReading) {
			this.awaitingFreshReading = false
			return { type: 'clear' }
		}

		// A written handoff ends the guard's job for this cycle: report
		// readiness, whatever the prompt size does next.
		if (this.requestedPath && this.options.isWritten(this.requestedPath)) {
			return { type: 'ready', status: HANDOFF_READY }
		}

		const effective = this.ceilingFor(ceiling, windowTokens)
		this.effectiveCeiling = effective
		const level = budgetLevel(tokens, effective)
		if (level === 'ok') {
			return { type: 'clear' }
		}
		const status = statusText(tokens, effective)
		if (level === 'warn') {
			if (this.hasWarned) return { type: 'status', status }
			this.hasWarned = true
			return { type: 'warn', status, tokens, ceiling: effective }
		}
		// Past the ceiling. The runway band below it is where the ask belongs -
		// it goes out at the settle boundary, where ending the run costs no
		// interrupted work, and what the runway reserves is the write that
		// follows. Past the ceiling that margin is already spent: a busy agent
		// keeps going for as long as it has tool calls left, and the settle can
		// be tens of thousands of tokens away. Observed 2026-09-19 (session
		// 01a0b968): the ceiling was crossed mid-run, the ask went out 36k later
		// at the settle, the provider refused the request, pi aborted the turn -
		// "Operation aborted" - and compacted its own generic summary in place
		// of the handoff. A steered ask is delivered at the next tool boundary,
		// so no tool call is cut short.
		if (tokens < effective) {
			if (this.pending) return { type: 'status', status }
			this.pending = true
			return { type: 'pending', status, tokens, ceiling: effective }
		}
		if (this.requestedPath) return { type: 'status', status }
		return this.requestHandoff(tokens, effective, at)
	}

	/**
	 * Decision for a settled agent, i.e. the moment pi will not continue on
	 * its own. The chain must not wait for a human here: ask for the handoff
	 * if the run ended at the ceiling, compact from it as soon as it exists,
	 * re-ask while it is missing, then report and stop.
	 */
	settled(at: Date = new Date()): SettleAction {
		const path = this.requestedPath
		if (!path) {
			// The ceiling was crossed but the ask never went out - a reload in
			// the middle of a run rebuilds the guard, and nothing else asks
			// once its run is over. This is the net for that case: without it
			// the session sits above its ceiling until the next turn happens to
			// cross it again.
			if (!this.pending || !this.sessionId || this.ceiling === 'off') {
				return { type: 'idle' }
			}
			this.pending = false
			this.requestedPath = handoffPath(
				this.options.agentDir,
				this.sessionId,
				at,
			)
			return {
				type: 'handoff',
				path: this.requestedPath,
				ceiling: this.effectiveCeiling ?? this.ceiling,
			}
		}
		if (this.options.isWritten(path)) {
			return this.settledWritten(path)
		}
		const { ceiling } = this
		if (ceiling === 'off') return { type: 'idle' }
		if (this.givenUp) return { type: 'idle' }
		if (this.settleRetries >= MAX_SETTLE_RETRIES) {
			// Latched: without this, every later settle reports the same give-up
			// and fires another directed compaction - observed 2026-09-19 as
			// stacked compactions aborting over one another in one session.
			this.givenUp = true
			return { type: 'givenUp', path }
		}
		this.settleRetries += 1
		return {
			type: 'reask',
			path,
			ceiling: this.effectiveCeiling ?? ceiling,
			retry: this.settleRetries,
		}
	}

	/**
	 * The requested handoff is on disk: compact from it - or, once three
	 * compactions for it have failed, give up once and then stay idle.
	 */
	private settledWritten(path: string): SettleAction {
		if (this.compactFailures < MAX_SETTLE_RETRIES) {
			return { type: 'compact', path }
		}
		if (this.givenUp) return { type: 'idle' }
		this.givenUp = true
		return { type: 'givenUp', path }
	}

	/**
	 * Ask for the handoff mid-turn. A request already in flight is never
	 * replaced: the settle boundary owns the re-asks, and a second path would
	 * strand the first handoff unconsumed.
	 */
	private requestHandoff(
		tokens: number,
		effective: number,
		at: Date,
	): GuardAction {
		if (!this.sessionId || this.requestedPath) {
			return { type: 'status', status: statusText(tokens, effective) }
		}
		const path = handoffPath(this.options.agentDir, this.sessionId, at)
		this.requestedPath = path
		this.pending = false
		return {
			type: 'handoff',
			status: statusText(tokens, effective),
			path,
			tokens,
			ceiling: effective,
		}
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
export function handoffMessage(request: HandoffRequest): string {
	return handoffDirective({
		ceiling: request.ceiling,
		path: request.path,
		retry: request.retry ?? 0,
	})
}
