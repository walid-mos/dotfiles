/**
 * goal-gate - the settle gate: one decision per settled run, no IO.
 *
 * `settled()` is called at `agent_settled`, the first moment pi will not
 * continue on its own, and returns the single action the caller must take. All
 * filesystem access is injected, so the transitions - continue while items are
 * open, stop on `blocked:` or a spent budget, report completion exactly once -
 * are unit-tested in `../tests/goal-gate.test.ts` without a session.
 */

import { ledgerPath, ledgerStatus } from './ledger.ts'

import type { LedgerStatus } from './ledger.ts'

/**
 * Continuations allowed before the gate stops fighting a model that will not
 * close the list. Bounded on purpose: an ignored checklist must not turn into an
 * unbounded loop of expensive turns. A human prompt resets the budget.
 */
export const MAX_CONTINUATIONS = 4

/**
 * What the caller should do once the agent has settled:
 * - `idle`     - nothing to gate: no session, no ledger, or the cycle is closed
 * - `continue` - items are open: send the continuation and let the run resume
 * - `done`     - every item is checked: report it and stop guarding
 * - `stopped`  - `blocked:` or a spent budget: report why and stop guarding
 */
export type SettleAction =
	| { type: 'idle' }
	| { type: 'continue'; path: string; status: LedgerStatus; attempt: number }
	| { type: 'done'; path: string; total: number }
	| { type: 'stopped'; path: string; reason: string; cause: StopCause }

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
		this.path = ledgerPath(this.options.agentDir, sessionId)
		this.attempts = 0
		this.closed = false
		this.reportedDone = undefined
		return this.path
	}

	/** Ledger this session tracks, once armed. */
	get ledgerFile(): string | undefined {
		return this.path
	}

	/**
	 * A human prompt reopens the cycle with a fresh budget: the goal stands
	 * until the ledger is empty or `/goal-clear` removes it.
	 */
	noteHumanPrompt(): void {
		this.attempts = 0
		this.closed = false
	}

	settled(): SettleAction {
		const { path } = this
		if (!path || this.closed) return { type: 'idle' }
		const text = this.options.read(path)
		if (!text) return { type: 'idle' }
		const status = ledgerStatus(text)
		if (status.blocked) {
			this.closed = true
			return {
				type: 'stopped',
				path,
				reason: status.blocked,
				cause: 'blocked',
			}
		}
		if (status.items.length && !status.open.length) {
			this.closed = true
			if (this.reportedDone === status.items.length)
				return { type: 'idle' }
			this.reportedDone = status.items.length
			return { type: 'done', path, total: status.items.length }
		}
		if (this.attempts >= MAX_CONTINUATIONS) {
			this.closed = true
			return {
				type: 'stopped',
				path,
				reason: `the checklist is still open after ${MAX_CONTINUATIONS} continuations`,
				cause: 'budget',
			}
		}
		this.attempts += 1
		return { type: 'continue', path, status, attempt: this.attempts }
	}
}
