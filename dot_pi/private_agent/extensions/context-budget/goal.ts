/**
 * context-budget - the goal-completed stand-down.
 *
 * A completed checklist ends the session's work, and a session with nothing
 * left to do must not pay for budget machinery: no continuation, no handoff
 * request, no re-ask, no compaction, no LLM call at all. The ledger file is
 * the single source of truth - goal-gate owns its syntax - so this module
 * reads the same file instead of sharing state with goal-gate: each extension
 * gets its own module registry, and a file read makes the handler order at
 * the settle boundary irrelevant.
 *
 * The stand-down is anchored to the completion, not permanent: it holds while
 * the ledger's last write is newer than the last interactive human prompt. A
 * human prompt lifts it - resuming is the human's decision, and the next
 * settle still over the ceiling arms the handoff then - and new work declared
 * through the `goal` tool rewrites the ledger, so a freshly completed
 * checklist arms the stand-down again on its own.
 */

import { readFileSync, statSync } from 'node:fs'

import {
	ledgerIsComplete,
	ledgerPath,
	ledgerStatus,
} from '../goal-gate/ledger.ts'

/**
 * The completion state one live session shares across decision points. A
 * class on purpose: the prompt clock and the notice marker are mutated from
 * event handlers, and mutating fields through methods keeps the linter's
 * no-param-reassign rule honest about where the state lives.
 */
export class GoalWatch {
	/** Milliseconds since the epoch of the last interactive human prompt. */
	lastHumanPromptAt = 0

	/** Completion whose stand-down notice already went out, if any. */
	private noticedCompletionAt: number | undefined

	/** A human is driving again: the stand-down lifts from this moment. */
	noteHumanPrompt(): void {
		this.lastHumanPromptAt = Date.now()
	}

	/** True when the stand-down notice for this completion already went out. */
	hasNoticedCompletion(completedAt: number): boolean {
		return this.noticedCompletionAt === completedAt
	}

	/** Record that the stand-down notice for this completion went out. */
	noteCompletionNotice(completedAt: number): void {
		this.noticedCompletionAt = completedAt
	}
}

/** A completed goal, as the stand-down decision needs it. */
export type GoalCompletion = {
	/** Ledger every item of is checked. */
	path: string
	/** The ledger's modification time - the completion moment, in ms. */
	completedAt: number
	/** Item count, for the one notice the caller shows. */
	total: number
}

/**
 * The session's completed goal, or undefined while it does not govern: no
 * ledger, work still open, a `blocked:` marker, or a human prompt newer than
 * the ledger's last write (the human resumed - the budget governs again).
 */
export function completedGoal(
	agentDir: string,
	sessionId: string,
	watch: GoalWatch,
): GoalCompletion | undefined {
	const path = ledgerPath(agentDir, sessionId)
	const text = readLedgerText(path)
	if (!text) return undefined
	const status = ledgerStatus(text)
	if (!ledgerIsComplete(status)) return undefined
	const completedAt = modifiedTime(path)
	if (completedAt <= watch.lastHumanPromptAt) return undefined
	return { path, completedAt, total: status.items.length }
}

/** Ledger text at `path`, or undefined when there is nothing readable there. */
function readLedgerText(path: string): string | undefined {
	try {
		const text = readFileSync(path, 'utf8')
		if (!text.trim()) return undefined
		return text
	} catch {
		return undefined
	}
}

/** Modification time in milliseconds, or 0 when the file vanished or is unreadable. */
function modifiedTime(path: string): number {
	try {
		return statSync(path).mtimeMs
	} catch {
		return 0
	}
}
