/** Filesystem access and retention for goal ledger files. */

import {
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'

import { getAgentDir } from '@earendil-works/pi-coding-agent'

import { expiredLedgers, goalsDir } from './ledger.ts'

import type { LedgerFile } from './ledger.ts'

/** Ledger text at `path`, or undefined when there is nothing readable there. */
export function readLedger(path: string): string | undefined {
	try {
		const text = readFileSync(path, 'utf8')
		if (!text.trim()) return undefined
		return text
	} catch {
		return undefined
	}
}

/** Write ledger text, creating the goals directory the first time. */
export function writeLedger(path: string, text: string): void {
	mkdirSync(goalsDir(getAgentDir()), { recursive: true })
	writeFileSync(path, text)
}

/** Best effort: an unwritable directory must not take the session down. */
export function ensureGoalsDir(): void {
	try {
		mkdirSync(goalsDir(getAgentDir()), { recursive: true })
	} catch {
		// Reading a ledger that cannot exist is already handled: the gate idles.
	}
}

/** Drop the ledgers past the retention window, never this session's own. */
export function pruneLedgers(activePath: string): void {
	const dir = goalsDir(getAgentDir())
	const expired = expiredLedgers(
		ledgerFiles(dir),
		Date.now(),
		basename(activePath),
	)
	for (const name of expired) rmSync(join(dir, name), { force: true })
}

/** Every file in the goals directory with its modification time. */
function ledgerFiles(dir: string): LedgerFile[] {
	let names: string[]
	try {
		names = readdirSync(dir)
	} catch {
		return []
	}
	const entries: LedgerFile[] = []
	for (const name of names) {
		const modifiedAt = modifiedTime(join(dir, name))
		if (modifiedAt) entries.push({ name, modifiedAt })
	}
	return entries
}

/** Modification time in milliseconds, or 0 when the file vanished or is unreadable. */
function modifiedTime(path: string): number {
	try {
		return statSync(path).mtimeMs
	} catch {
		return 0
	}
}
