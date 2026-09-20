/**
 * goal-gate - the settle gate: one decision per settled run, no IO.
 *
 * `settled()` is called at `agent_settled`, the first moment pi will not
 * continue on its own, and returns the single action the caller must take. All
 * filesystem access is injected, so the transitions - continue while items are
 * open, stop on `blocked:` or a spent budget, report completion exactly once -
 * are unit-tested in `../tests/goal-gate.test.ts` without a session.
 */

import { ledgerIsComplete, ledgerPath, ledgerStatus } from './ledger.ts'

import type { LedgerStatus } from './ledger.ts'

/**
 * Continuations allowed before the gate stops fighting a model that will not
 * close the list. Bounded on purpose: an ignored checklist must not turn into an
 * unbounded loop of expensive turns. A human prompt resets the budget.
 */
export const MAX_CONTINUATIONS = 4

/**
 * Escalations allowed per cycle. A run that stops blocked - or that ignores the
 * whole continuation budget - has asked the human nothing, so its pane settles
 * exactly like a finished one. One message demanding the blocking decision be
 * raised with `ask_user_question` is what makes the stop visible; bounded like
 * the continuations, and reset by a human prompt with them.
 */
export const MAX_ESCALATIONS = 1

/**
 * What the caller should do once the agent has settled:
 * - `idle`     - nothing to gate: no session, no ledger, or the cycle is closed
 * - `continue` - items are open: send the continuation and let the run resume
 * - `ask`      - the run stopped without asking: demand the blocking question
 * - `done`     - every item is checked: report it and stop guarding
 * - `stopped`  - `blocked:` or a spent budget: report why and stop guarding
 */
export type SettleAction =
	| { type: 'idle' }
	| { type: 'continue'; path: string; status: LedgerStatus; attempt: number }
	| { type: 'ask'; path: string; reason: string; status: LedgerStatus }
	| { type: 'done'; path: string; total: number }
	| {
			type: 'stopped'
			path: string
			reason: string
			cause: StopCause
			status: LedgerStatus
	  }

/**
 * Why the gate stopped: `blocked` is the run asking for something it cannot get,
 * `budget` is this extension refusing to keep pushing. They read differently to
 * the human, so the caller must not have to parse the reason to tell them apart.
 */
export type StopCause = 'blocked' | 'budget'

export type GateOptions = {
	agentDir: string
	/** Ledger text at a path, or undefined when there is none to read. */
	read: (path: string) => string | undefined
}

export class GoalGate {
	private readonly options: GateOptions
	private path: string | undefined
	private attempts = 0
	/** Escalations spent in this cycle; see `MAX_ESCALATIONS`. */
	private escalations = 0
	/** Set once the cycle is over: completion reported, blocked, or given up. */
	private closed = false
	/**
	 * Item count already reported as complete. Kept past a reopen so that
	 * touching the finished list again does not report the same completion, while
	 * genuinely new items do.
	 */
	private reportedDone: number | undefined

	constructor(options: GateOptions) {
		this.options = options
	}

	/**
	 * Open a cycle for a session and return the ledger it tracks. Called at
	 * `session_start`.
	 */
	arm(sessionId: string): string {
		return this.armLedger(ledgerPath(this.options.agentDir, sessionId))
	}

	/**
	 * Open a cycle tracking a ledger adopted from a predecessor session
	 * (resume or fork): the checklist belongs to the work, not to the id pi
	 * minted for this session.
	 */
	armLedger(path: string): string {
		this.path = path
		this.attempts = 0
		this.escalations = 0
		this.closed = false
		this.reportedDone = undefined
		return this.path
	}

	/** Ledger this session tracks, once armed. */
	get ledgerFile(): string | undefined {
		return this.path
	}

	/**
	 * A human prompt reopens the cycle with a fresh budget: by the time someone
	 * has typed "continue", the earlier budget was spent on a different
	 * situation. The goal itself stands until the ledger has no open item, or
	 * `/goal-clear` removes it.
	 */
	noteHumanPrompt(): void {
		this.resetCycle()
	}

	/**
	 * Work the run declared (`/goal`, or the `goal` tool). A closed cycle - every
	 * item ticked, the budget spent, or `blocked:` - becomes live again with a
	 * fresh budget; a cycle that is still live keeps the budget it has already
	 * spent, so declaring more items cannot buy escapes from the continuation
	 * limit.
	 */
	noteNewWork(): void {
		if (!this.closed) return
		this.resetCycle()
	}

	private resetCycle(): void {
		this.attempts = 0
		this.escalations = 0
		this.closed = false
	}

	settled(): SettleAction {
		const { path } = this
		if (!path || this.closed) return { type: 'idle' }
		const text = this.options.read(path)
		if (!text) return { type: 'idle' }
		const status = ledgerStatus(text)
		if (status.blocked) {
			const escalation = this.escalate(path, status.blocked, status)
			if (escalation) return escalation
			this.closed = true
			return {
				type: 'stopped',
				path,
				reason: status.blocked,
				cause: 'blocked',
				status,
			}
		}
		if (ledgerIsComplete(status)) {
			this.closed = true
			if (this.reportedDone === status.items.length)
				return { type: 'idle' }
			this.reportedDone = status.items.length
			return { type: 'done', path, total: status.items.length }
		}
		if (this.attempts >= MAX_CONTINUATIONS) {
			const reason = `the checklist is still open after ${MAX_CONTINUATIONS} continuations`
			const escalation = this.escalate(path, reason, status)
			if (escalation) return escalation
			this.closed = true
			return { type: 'stopped', path, reason, cause: 'budget', status }
		}
		this.attempts += 1
		return { type: 'continue', path, status, attempt: this.attempts }
	}

	/**
	 * Completion check without touching the cycle state: the caller runs it
	 * before any other extension's settle machinery, so a finished checklist
	 * stops the session before a handoff request, a compaction or any
	 * continuation can be paid for. `settled()` re-derives this with its
	 * bookkeeping; this probe never mutates, so calling it speculatively costs
	 * nothing.
	 */
	probeDone(): { path: string; total: number } | undefined {
		const { path } = this
		if (!path) return undefined
		const text = this.options.read(path)
		if (!text) return undefined
		const status = ledgerStatus(text)
		if (!ledgerIsComplete(status)) return undefined
		return { path, total: status.items.length }
	}

	/**
	 * The one message that turns a silent stop into a question, while the cycle's
	 * escalation budget lasts. Undefined means the gate has escalated as often as
	 * it may: the caller stops for good.
	 */
	private escalate(
		path: string,
		reason: string,
		status: LedgerStatus,
	): SettleAction | undefined {
		if (this.escalations >= MAX_ESCALATIONS) return undefined
		this.escalations += 1
		return { type: 'ask', path, reason, status }
	}
}
