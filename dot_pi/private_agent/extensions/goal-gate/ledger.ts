/**
 * goal-gate - the task ledger: where it lives, how it is parsed, and what is
 * still open in it.
 *
 * Pure: no IO, no pi, no TUI. `index.ts` reads the file and performs the
 * decisions, `gate.ts` holds the state machine, `ledger-edits.ts` the write
 * side a `goal` call applies, `directive.ts` the texts the agent receives.
 */

import { join } from 'node:path'

/** Ledgers live beside the handoffs: one file per session. */
const LEDGER_DIR = 'goals'

/** Only these are ledgers; anything else in the directory is left alone. */
const LEDGER_EXTENSION = '.md'

/**
 * Session ids are uuids, and this prefix is the ledger's whole identity: two
 * sessions sharing it would share one checklist, and the second one's write
 * would silently replace the first one's goal. Sixteen hex characters put that
 * at zero for any plausible number of sessions, where eight left it to chance.
 */
const SESSION_PREFIX_LENGTH = 16

/** Item syntax: `- [ ] text` open, `- [x] text` done. */
export const ITEM_PATTERN = /^\s*[-*]\s+\[([ xX])\]\s+(.*\S)\s*$/

/** `blocked: reason` - the one way a run stands the gate down on purpose. */
export const BLOCKED_PATTERN = /^\s*blocked\s*:(.*)$/i

/** Separators a `/goal` argument uses between items. */
const ITEM_SEPARATORS = /[;\n]/

/** Capture groups of `ITEM_PATTERN`: state first, then the item's text. */
export const ITEM_STATE_GROUP = 1
export const ITEM_TEXT_GROUP = 2

export type LedgerItem = {
	done: boolean
	text: string
}

/**
 * How long a ledger file stays on disk. One file is written per session that
 * declares work, so without a window this directory grows forever; two weeks are
 * enough to go back and read what a recent session was doing, and the transcript
 * in `sessions/` remains the real record.
 */
export const LEDGER_RETENTION_DAYS = 14

const MILLISECONDS_PER_DAY = 86_400_000

/** One ledger file on disk, as retention sees it. */
export type LedgerFile = {
	name: string
	/** Modification time, in milliseconds since the epoch. */
	modifiedAt: number
}

export type LedgerStatus = {
	/** Every checklist item, in file order. */
	items: LedgerItem[]
	/** Text of the unchecked items, in file order. */
	open: string[]
	/** Reason a run declared itself blocked, if it did. */
	blocked: string | undefined
}

export function goalsDir(agentDir: string): string {
	return join(agentDir, LEDGER_DIR)
}

/** `<goals>/<session>.md` - one path for the whole life of the session. */
export function ledgerPath(agentDir: string, sessionId: string): string {
	const prefix = sessionId.replaceAll('-', '').slice(0, SESSION_PREFIX_LENGTH)
	return join(goalsDir(agentDir), `${prefix}${LEDGER_EXTENSION}`)
}

/**
 * Read one ledger. Lines that are not checklist items stay prose - the objective
 * above the list is written in whatever form the author wanted, and only the
 * items decide whether work is left.
 */
export function ledgerStatus(text: string): LedgerStatus {
	const items: LedgerItem[] = []
	let blocked: string | undefined
	for (const line of text.split('\n')) {
		const checklistItem = ITEM_PATTERN.exec(line)
		if (checklistItem) {
			items.push({
				done: checklistItem[ITEM_STATE_GROUP] !== ' ',
				text: checklistItem[ITEM_TEXT_GROUP] ?? '',
			})
			continue
		}
		const marker = BLOCKED_PATTERN.exec(line)
		if (marker && !blocked) {
			blocked = (marker[1] ?? '').trim() || 'no reason given'
		}
	}
	return {
		items,
		open: items
			.filter(checklistItem => !checklistItem.done)
			.map(checklistItem => checklistItem.text),
		blocked,
	}
}

/**
 * True when the checklist exists, nothing is blocked, and no item is open.
 * The one definition of "the goal is done" - the settle gate and the
 * context-budget stand-down both read the ledger through it.
 */
export function ledgerIsComplete(status: LedgerStatus): boolean {
	return !status.blocked && status.items.length > 0 && !status.open.length
}

/** Items a `/goal` argument declares, in the order they were written. */
export function splitItems(raw: string): string[] {
	return raw
		.split(ITEM_SEPARATORS)
		.map(declaredItem => declaredItem.trim())
		.filter(Boolean)
}

/** Goal-checklist paths a text names, deduplicated, in first-seen order. */
const MENTION_PATTERN = /goal checklist at (\S+?\.md)/gi

/**
 * Every ledger path a transcript text mentions, in the order they appear. The
 * gate's own messages are what carry these - a continuation and an escalation
 * both name the path - so a predecessor's transcript reveals the ledger it was
 * tracking. Callers filter for what still exists and still has open work.
 */
export function ledgerMentions(text: string): string[] {
	const mentioned: string[] = []
	for (const match of text.matchAll(MENTION_PATTERN)) {
		const [, named] = match
		if (named && !mentioned.includes(named)) mentioned.push(named)
	}
	return mentioned
}

/**
 * Ledgers past the retention window, by file name. The session's own ledger is
 * never among them - a long-lived session can hold a checklist older than the
 * window, and deleting the file a live gate is reading would silently end it.
 */
export function expiredLedgers(
	entries: LedgerFile[],
	now: number,
	keepName: string,
): string[] {
	const cutoff = now - LEDGER_RETENTION_DAYS * MILLISECONDS_PER_DAY
	return entries
		.filter(
			entry =>
				entry.name !== keepName &&
				entry.name.endsWith(LEDGER_EXTENSION) &&
				entry.modifiedAt < cutoff,
		)
		.map(entry => entry.name)
}

/** The ledger file an explicit `/goal` writes, in the syntax `ledgerStatus` reads back. */
export function renderLedger(items: string[]): string {
	const lines = ['# Goal', '']
	for (const declaredItem of items) lines.push(`- [ ] ${declaredItem}`)
	return `${lines.join('\n')}\n`
}
