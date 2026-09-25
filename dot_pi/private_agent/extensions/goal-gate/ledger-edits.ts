/**
 * goal-gate - the write side of the ledger: what one `goal` call changes.
 *
 * Pure: no IO, no pi, no TUI. The tool layer reads the file, applies one of
 * these, and writes the result back; every rule that decides what the ledger
 * becomes lives here.
 *
 * The ledger is append-only in spirit: declaring adds items the file does not
 * carry yet, ticking rewrites one open line, and neither drops the outcomes
 * already recorded. That text is the memory a post-compaction or fresh session
 * re-reads, so losing it would defeat the checklist.
 *
 * One line is not append-only: a `blocked:` marker belongs to the cycle that
 * recorded it. A run that writes to the checklist again is acting on it, so the
 * marker is dropped by the very write that resumes the work - left in place it
 * would close the next settle on a decision the human has already answered.
 */

import {
	BLOCKED_PATTERN,
	ITEM_PATTERN,
	ITEM_STATE_GROUP,
	ITEM_TEXT_GROUP,
	isRequestItem,
	ledgerStatus,
	renderLedger,
} from './ledger.ts'

import type { LedgerStatus } from './ledger.ts'

/** The open marker of `ITEM_PATTERN`'s state group. */
const OPEN_MARK = ' '

/** What `declareItems` added and what it left alone as already known. */
export type LedgerDeclaration = {
	text: string
	added: string[]
	skipped: string[]
}

/**
 * The result of one tick: `ticked` carries the ledger to write, and the two
 * others are the reasons nothing was written - an item already closed is not a
 * failure, an item the file never carried is.
 */
export type LedgerTick =
	| { type: 'ticked'; text: string; status: LedgerStatus }
	| { type: 'already'; status: LedgerStatus }
	| { type: 'unknown'; status: LedgerStatus }

/**
 * How an item's text is compared. Ticking echoes the declared text, so the
 * match forgives case and spacing - a near miss would otherwise cost a turn -
 * while still refusing an item that was never declared.
 */
export function normalizeItem(text: string): string {
	return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * The ledger with `items` appended, skipping empty ones and any item the file
 * already carries (ticked or open). The heading is added when the file has no
 * text yet, so the first declaration from the tool reads like `/goal`'s.
 */
export function declareItems(
	text: string | undefined,
	items: string[],
): LedgerDeclaration {
	const existing = text ?? ''
	const recorded = ledgerStatus(existing).items.map(entry => entry.text)
	const added: string[] = []
	const skipped: string[] = []
	for (const declared of items) {
		const trimmed = declared.trim()
		const key = normalizeItem(trimmed)
		if (
			!key ||
			recorded.some(recordedItem => matchesRecorded(recordedItem, key))
		) {
			skipped.push(trimmed)
			continue
		}
		recorded.push(trimmed)
		added.push(trimmed)
	}
	if (!added.length) return { text: existing, added, skipped }
	const head = existing.trim()
		? withoutBlockMarker(existing).trimEnd()
		: renderLedger([]).trimEnd()
	const lines = added.map(addedItem => `- [ ] ${addedItem}`)
	return { text: `${[head, ...lines].join('\n')}\n`, added, skipped }
}

/**
 * Whether a recorded item is the one being matched. A closed line reads back as
 * `<item> - <outcome>`, so the item is a prefix of its text; an open line still
 * reads back whole.
 */
function matchesRecorded(recorded: string, wanted: string): boolean {
	const text = normalizeItem(recorded)
	return text === wanted || text.startsWith(`${wanted} - `)
}

/**
 * The ledger with the open item matching `item` rewritten as
 * `- [x] <item> - <outcome>`. The first open match wins: two items with the
 * same text are the same deliverable written twice, and the closer one is the
 * one already on the list.
 */
export function tickItem(
	text: string,
	declaredItem: string,
	outcome: string,
): LedgerTick {
	const wanted = normalizeItem(declaredItem)
	const lines = text.split('\n')
	for (let index = 0; index < lines.length; index += 1) {
		const match = ITEM_PATTERN.exec(lines[index] ?? '')
		if (!match || match[ITEM_STATE_GROUP] !== OPEN_MARK) continue
		const recorded = match[ITEM_TEXT_GROUP] ?? ''
		if (!matchesRecorded(recorded, wanted)) continue
		lines[index] = `- [x] ${recorded} - ${outcome.trim()}`
		const rewritten = withoutBlockMarker(lines.join('\n'))
		return {
			type: 'ticked',
			text: rewritten,
			status: ledgerStatus(rewritten),
		}
	}
	const status = ledgerStatus(text)
	const isTicked = status.items.some(
		entry => entry.done && matchesRecorded(entry.text, wanted),
	)
	return { type: isTicked ? 'already' : 'unknown', status }
}

/** Close a false work classification only before this request declared any deliverable. */
export function dismissRequest(text: string, reason: string): string {
	if (!reason.trim()) throw new Error('goal dismiss needs a reason.')
	const status = ledgerStatus(text)
	const pending = status.items.filter(entry => !entry.done)
	const [request] = pending
	if (pending.length !== 1 || !request || !isRequestItem(request.text))
		throw new Error('goal dismiss requires exactly one open request item.')
	const requestIndex = status.items.findIndex(entry => !entry.done)
	if (status.items.slice(requestIndex + 1).length)
		throw new Error(
			'goal dismiss refused: concrete work was declared for this request.',
		)
	const tick = tickItem(
		text,
		request.text,
		`No deliverable: ${reason.trim()}`,
	)
	if (tick.type !== 'ticked')
		throw new Error('goal dismiss could not close the request item.')
	return tick.text
}

/**
 * The ledger with any `blocked:` marker removed. The marker is the stop a run
 * recorded for one state of the checklist, so it goes as soon as the run writes
 * again - the reason would otherwise outlive the decision it named.
 */
function withoutBlockMarker(text: string): string {
	return text
		.split('\n')
		.filter(line => !BLOCKED_PATTERN.test(line))
		.join('\n')
}

/**
 * The ledger with `blocked: <reason>` as its last line - the marker `settled()`
 * reads to stand the gate down. Any earlier one is replaced: the newest reason
 * is the decision the human still has to answer.
 */
export function blockLedger(text: string | undefined, reason: string): string {
	const kept = withoutBlockMarker(text ?? '').trimEnd()
	return `${kept ? `${kept}\n` : ''}blocked: ${reason.trim()}\n`
}
