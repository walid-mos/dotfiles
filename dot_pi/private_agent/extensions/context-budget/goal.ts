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
 * The stand-down holds for as long as the ledger stays complete, and nothing
 * but the ledger lifts it: work declared through the `goal` tool (or `/goal`)
 * rewrites the file, and an open item puts the budget back in charge. A bare
 * human prompt does not - lifting on the prompt alone re-armed the whole
 * handoff pipeline for a finished checklist on every casual prompt (observed
 * 2026-09-20, session 01a0bbda: "lance un syneva" after a completed spike
 * fired a handoff request at a session whose goal was done, and the retry
 * loop that followed burned three re-asks and a directed compaction on
 * finished work).
 */

import { readFileSync, statSync } from 'node:fs'

import {
	ledgerIsComplete,
	ledgerPath,
	ledgerStatus,
} from '../goal-gate/ledger.ts'

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
 * ledger, work still open, or a `blocked:` marker. The completion stands
 * until the ledger itself changes - see the module comment.
 */
export function completedGoal(
	agentDir: string,
	sessionId: string,
): GoalCompletion | undefined {
	const path = ledgerPath(agentDir, sessionId)
	const text = readLedgerText(path)
	if (!text) return undefined
	const status = ledgerStatus(text)
	if (!ledgerIsComplete(status)) return undefined
	const completedAt = modifiedTime(path)
	if (!completedAt) return undefined
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
