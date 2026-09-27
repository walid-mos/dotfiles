/**
 * goal-gate - the ledger a session inherits across a resume or a fork.
 *
 * Resuming or forking mints a new session id, and the checklist path is
 * derived from it - so a resumed conversation starts with a ledger path that
 * does not exist while its open items sit under the previous id. The
 * predecessor's own continuation messages name the ledger it was tracking;
 * the newest of those whose file still exists, still has open items, and is
 * not blocked is the one to adopt. The checklist belongs to the work, not to
 * the id.
 */

import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

import { goalsDir, ledgerMentions, ledgerStatus } from './ledger.ts'

/** How much of a predecessor's transcript to scan for ledger mentions. */
const INHERIT_SCAN_BYTES = 262_144

/** Only a goals-directory ledger name is trusted: sixteen hex chars plus .md. */
const LEDGER_NAME_PATTERN = /^[0-9a-f]{16}\.md$/

/** The last `maxBytes` of a file, or an empty string when it cannot be read. */
function readTail(path: string, maxBytes: number): string {
	try {
		const stats = statSync(path)
		const start = Math.max(0, stats.size - maxBytes)
		const length = stats.size - start
		const buffer = Buffer.alloc(length)
		const descriptor = openSync(path, 'r')
		try {
			readSync(descriptor, buffer, 0, length, start)
		} finally {
			closeSync(descriptor)
		}
		return buffer.toString('utf8')
	} catch {
		return ''
	}
}

/**
 * Every ledger path the user messages of a transcript tail name, newest last.
 * Only user messages are scanned: the gate's continuations and escalations are
 * user messages and carry the path, while tool results echo paths a run merely
 * printed.
 */
function mentionedLedgers(transcript: string): string[] {
	const mentioned: string[] = []
	for (const line of transcript.split('\n')) {
		let parsed: unknown
		try {
			parsed = JSON.parse(line)
		} catch {
			continue // a tail boundary splits lines; that one says nothing
		}
		mentioned.push(...ledgerMentions(userMessageText(parsed)))
	}
	return [...new Set(mentioned)]
}

/** The JSON text of a user message entry, or '' for anything else. */
function userMessageText(parsedEntry: unknown): string {
	if (typeof parsedEntry !== 'object' || parsedEntry === null) return ''
	if (!('type' in parsedEntry) || !('message' in parsedEntry)) return ''
	const { type, message } = parsedEntry
	if (type !== 'message' || typeof message !== 'object' || message === null)
		return ''
	if (!('role' in message) || !('content' in message)) return ''
	const { role, content } = message
	if (role !== 'user') return ''
	return JSON.stringify(content ?? '')
}

export type InheritInput = {
	/** The session file the previous incarnation of this conversation used. */
	previousSessionFile: string | undefined
	agentDir: string
	/** Ledger text at a path, or undefined when there is none to read. */
	read: (path: string) => string | undefined
}

/**
 * The ledger to adopt, or `undefined` when there is nothing to adopt: no
 * predecessor named, no transcript readable, no mention that still resolves
 * to an open, unblocked checklist inside this agent's goals directory. Only
 * user messages are scanned for mentions - a tool result echoes paths a run
 * merely printed.
 */
export function inheritedLedger(input: InheritInput): string | undefined {
	if (!input.previousSessionFile) return undefined
	const mentions = mentionedLedgers(
		readTail(input.previousSessionFile, INHERIT_SCAN_BYTES),
	)
	for (let i = mentions.length - 1; i >= 0; i--) {
		const mentioned = mentions[i]
		if (!mentioned) continue
		const name = basename(mentioned)
		if (!LEDGER_NAME_PATTERN.test(name)) continue
		const path = join(goalsDir(input.agentDir), name)
		const text = input.read(path)
		if (!text) continue
		const status = ledgerStatus(text)
		if (status.open.length && !status.blocked) return path
	}
	return undefined
}
