/** Read the goal-gate ledger for stand-down and compaction checkpoints. */

import { readFileSync, statSync } from 'node:fs'

import {
	ledgerIsComplete,
	ledgerPath,
	ledgerStatus,
} from '../goal-gate/ledger.ts'

export type GoalSnapshot = {
	path: string
	completedAt: number | undefined
	items: { done: boolean; text: string }[]
	open: string[]
	blocked: string | undefined
}

export type GoalCompletion = {
	path: string
	completedAt: number
	total: number
}

export function goalSnapshot(
	agentDir: string,
	sessionId: string,
): GoalSnapshot | undefined {
	const path = ledgerPath(agentDir, sessionId)
	const text = readLedgerText(path)
	if (!text) return undefined
	const status = ledgerStatus(text)
	return {
		path,
		completedAt: modifiedTime(path) || undefined,
		items: status.items,
		open: status.open,
		blocked: status.blocked,
	}
}

export function completedGoal(
	agentDir: string,
	sessionId: string,
): GoalCompletion | undefined {
	const snapshot = goalSnapshot(agentDir, sessionId)
	if (!snapshot || !ledgerIsComplete(snapshot)) return undefined
	if (!snapshot.completedAt) return undefined
	return {
		path: snapshot.path,
		completedAt: snapshot.completedAt,
		total: snapshot.items.length,
	}
}

function readLedgerText(path: string): string | undefined {
	try {
		const text = readFileSync(path, 'utf8')
		if (!text.trim()) return undefined
		return text
	} catch {
		return undefined
	}
}

function modifiedTime(path: string): number {
	try {
		return statSync(path).mtimeMs
	} catch {
		return 0
	}
}
