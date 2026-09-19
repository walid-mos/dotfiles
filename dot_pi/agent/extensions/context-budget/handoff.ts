/**
 * context-budget - handoff files: their path and their retention.
 *
 * The guard generates the handoff path itself, so the nudge the agent receives
 * and the compaction that consumes the file agree on one path without the model
 * choosing a name. The content rules live in the directive itself; the
 * registered `handoff` skill is the human-facing `/handoff` entry point, not an
 * input to the nudge.
 */

import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Session ids are uuids; eight characters are enough to name a file after one. */
const SESSION_PREFIX_LENGTH = 8
const TWO_DIGITS = 2
const STAMP_SEPARATOR = '-'

/** Only these are handoffs; anything else in the directory is left alone. */
const HANDOFF_EXTENSION = '.md'

/**
 * How long a handoff file stays on disk. Only the session that asked for a
 * handoff ever reads it (the path lives in that session's memory), so this
 * window is housekeeping for the on-disk corpus a human may scroll through -
 * two weeks of records, kept small, never load-bearing.
 */
export const HANDOFF_RETENTION_DAYS = 14

const MILLISECONDS_PER_DAY = 86_400_000

/** Zero-pad one stamp component. */
function padToTwo(digits: number): string {
	return `${digits}`.padStart(TWO_DIGITS, '0')
}

export function handoffDir(agentDir: string): string {
	return join(agentDir, 'handoffs')
}

/**
 * `<handoffs>/<session>-<YYYYMMDD-HHmmss>.md`, stamped in local time. Seconds
 * are part of the name because a session can reach the ceiling more than once:
 * two cycles in the same minute must not share a path, or an ignored second
 * request would leave the first handoff in place and be consumed as if it were
 * current.
 */
/** Leading characters of a session id that name its files. */
export function sessionFilePrefix(sessionId: string): string {
	return sessionId.slice(0, SESSION_PREFIX_LENGTH)
}

export function handoffPath(
	agentDir: string,
	sessionId: string,
	at: Date,
): string {
	const stamp = [
		at.getFullYear(),
		padToTwo(at.getMonth() + 1),
		padToTwo(at.getDate()),
		STAMP_SEPARATOR,
		padToTwo(at.getHours()),
		padToTwo(at.getMinutes()),
		padToTwo(at.getSeconds()),
	].join('')
	const prefix = sessionFilePrefix(sessionId)
	return join(handoffDir(agentDir), `${prefix}-${stamp}.md`)
}

/** One handoff file on disk, as retention sees it. */
export type HandoffFile = {
	name: string
	/** Modification time, in milliseconds since the epoch. */
	modifiedAt: number
}

/**
 * Handoffs past the retention window, by file name. The current session's own
 * handoffs are never among them: a session crosses the ceiling several times,
 * and deleting the file it is about to compact from would cancel that
 * compaction rather than save anything.
 */
export function expiredHandoffs(
	entries: HandoffFile[],
	now: number,
	sessionPrefix: string,
): string[] {
	const cutoff = now - HANDOFF_RETENTION_DAYS * MILLISECONDS_PER_DAY
	return entries
		.filter(
			entry =>
				!entry.name.startsWith(`${sessionPrefix}${STAMP_SEPARATOR}`) &&
				entry.name.endsWith(HANDOFF_EXTENSION) &&
				entry.modifiedAt < cutoff,
		)
		.map(entry => entry.name)
}

/**
 * Drop the expired handoffs of one agent dir. Checked once per session, because
 * a handoff is only ever consumed by the session that asked for it. Best
 * effort: retention is housekeeping, and an unreadable directory must not take
 * a session down.
 */
export function pruneHandoffs(agentDir: string, sessionId: string): void {
	try {
		const dir = handoffDir(agentDir)
		const expired = expiredHandoffs(
			handoffFiles(dir),
			Date.now(),
			sessionFilePrefix(sessionId),
		)
		for (const name of expired) rmSync(join(dir, name), { force: true })
	} catch {
		// Nothing to prune, or nothing removable: either way, nothing to do.
	}
}

/** Every handoff file in the directory with its modification time. */
function handoffFiles(dir: string): HandoffFile[] {
	let names: string[]
	try {
		names = readdirSync(dir)
	} catch {
		// No directory yet: there is nothing to prune.
		return []
	}
	const entries: HandoffFile[] = []
	for (const name of names) {
		const modifiedAt = modifiedTime(join(dir, name))
		if (modifiedAt) entries.push({ name, modifiedAt })
	}
	return entries
}

/** Modification time in ms, or undefined for anything that is not a file. */
function modifiedTime(path: string): number | undefined {
	try {
		const stats = statSync(path)
		if (!stats.isFile()) return undefined
		return stats.mtimeMs
	} catch {
		return undefined
	}
}

/**
 * Smallest document that can carry goal, state and a next step. A few hundred
 * bytes is a stub - an apology, an error page, a truncated write - and would
 * become the session's memory of a whole conversation.
 */
export const MIN_HANDOFF_BYTES = 512

/** Every real handoff names what happens next; a doc without one is a stub. */
const NEXT_STEP_MARKER = /next step/i

/**
 * Whether a file can serve as the session's memory: a regular file of real
 * size that names a next step. Anything else takes the existing safe path -
 * the settle re-asks, and the compaction is cancelled rather than performed
 * with a stub in the handoff's place.
 */
export function isUsableHandoff(path: string): boolean {
	try {
		const stats = statSync(path)
		if (!stats.isFile() || stats.size < MIN_HANDOFF_BYTES) return false
		return NEXT_STEP_MARKER.test(readFileSync(path, 'utf8'))
	} catch {
		return false
	}
}
