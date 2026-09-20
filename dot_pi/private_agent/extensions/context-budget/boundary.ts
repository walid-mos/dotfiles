/**
 * context-budget - the compaction boundary: which entries survive in the
 * context after a handoff-driven compaction.
 *
 * pi picks its own cut point by walking backwards and accumulating token
 * estimates until `keepRecentTokens` is reached - but the estimate is built
 * from a serialization that truncates tool results, so a tail full of large
 * tool outputs passes the walk while weighing several times its estimate.
 * Measured 2026-09-19 over the session logs: 21 of 191 compactions left the
 * next billed prompt above 100k, and the turns they kept running at ceiling
 * prices billed 20.7M tokens more than already-compacted turns would have.
 *
 * This module keeps none of that budget rule. The handoff is the memory of
 * everything written before it, so the kept tail is exactly the work the
 * handoff does not cover: the newest valid cut point at or before the
 * handoff's write time. Entries older than that live in the handoff; entries
 * newer exist nowhere else and stay however big they are - a delta larger
 * than `keepRecentTokens` is not kept on purpose either, it is absorbed by
 * the guard asking for a new handoff that summarises it. The fallback is
 * pi's own boundary: without a handoff write time no chosen boundary is
 * provably covered by the summary, and a boundary this module cannot justify
 * is never better than the one pi chose.
 */

import type { SessionEntry } from '@earendil-works/pi-coding-agent'

export type BoundaryInput = {
	/** The branch's entries, oldest first, as the compaction event reports them. */
	entries: SessionEntry[]
	/** pi's own cut point: used when no better boundary can be justified. */
	fallbackId: string
	/**
	 * When the handoff file was written, in epoch milliseconds. Entries newer
	 * than this must survive: the handoff was written before them and is their
	 * only other record. `undefined` means no floor - there is no handoff.
	 */
	handoffWrittenAt?: number | undefined
}

/**
 * First entry kept by the compaction: the newest valid cut point at or before
 * the handoff's write time, so the kept tail is exactly the work the handoff
 * does not cover. Falls back to pi's boundary when there is no handoff write
 * time to bound the summary's coverage, or no valid cut point at all.
 */
export function pickKeptBoundary(input: BoundaryInput): string {
	// Without a write time the handoff's coverage is unknown: no boundary this
	// module could choose is provably covered by the summary, so pi's own cut
	// is the only safe one.
	if (!input.handoffWrittenAt) return input.fallbackId

	// Entries before the last compaction's kept boundary are not in the
	// context: pi rebuilds it as that summary plus the entries from its
	// `firstKeptEntryId`, so the walk must start there, not at the root.
	const start = effectiveStart(input.entries)
	if (start === -1) return input.fallbackId

	return deltaBoundary(input.entries, start, input) ?? input.fallbackId
}

/**
 * The newest boundary that still respects the floor, or `undefined` when the
 * branch has no valid cut point at all. Everything before it is covered by
 * the handoff and dropped; everything after it exists nowhere else and stays -
 * however big the delta is. The kept tail is therefore as small as the floor
 * allows, never filled up to a token budget.
 */
function deltaBoundary(
	entries: SessionEntry[],
	start: number,
	input: BoundaryInput,
): string | undefined {
	let boundary: string | undefined
	for (let i = start; i < entries.length; i++) {
		const entry = entries[i]
		if (!entry) continue
		if (!isCutPoint(entry)) continue
		if (dropsHandoff(entry, input)) continue
		boundary = entry.id
	}
	return boundary
}

/**
 * Index where the effective context starts: just past the last compaction's
 * dropped region. `-1` means there is nothing to weigh (no entries).
 */
function effectiveStart(entries: SessionEntry[]): number {
	if (!entries.length) return -1
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i]
		if (!entry || entry.type !== 'compaction') continue
		const keptIndex = entries.findIndex(
			candidate => candidate.id === entry.firstKeptEntryId,
		)
		// pi's own fallback when a kept boundary went missing: the entry
		// after the compaction itself.
		return keptIndex === -1 ? i + 1 : keptIndex
	}
	return 0
}

/**
 * Whether a boundary may start the kept region here. Tool results never do -
 * the tool call they answer would be summarized away from under them - and
 * neither do bookkeeping entries that carry no message.
 */
function isCutPoint(entry: SessionEntry): boolean {
	if (entry.type === 'custom_message') return true
	if (entry.type !== 'message') return false
	return entry.message.role === 'user' || entry.message.role === 'assistant'
}

/**
 * Whether cutting at this entry would drop the work done after the handoff
 * was written. Entries carry ISO timestamps; a boundary must sit at or before
 * the handoff's write time, and anything unparsable is treated as old, since
 * a stale timestamp must not widen the kept tail.
 */
function dropsHandoff(entry: SessionEntry, input: BoundaryInput): boolean {
	if (!input.handoffWrittenAt) return false
	const written = Date.parse(entry.timestamp)
	if (Number.isNaN(written)) return false
	return written > input.handoffWrittenAt
}
