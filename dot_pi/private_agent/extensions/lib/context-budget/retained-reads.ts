/** Exact, bounded skill reads kept outside the lossy checkpoint summary. */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { relative, resolve, sep } from 'node:path'

import { getAgentDir } from '@earendil-works/pi-coding-agent'

import type { SessionEntry } from '@earendil-works/pi-coding-agent'

const START = '\n<retained-skill-reads>\n'
const END = '\n</retained-skill-reads>'
const MAX_CHARS = 32_000

type RetainedRead = { path: string; toolCallId: string; content: unknown }

/** Skill markdown under the agent dir: `skills/**` and every vendored package's `skills/**`. */
function isSkillReference(path: string): boolean {
	const inside = relative(getAgentDir(), path)
	if (inside.startsWith('..') || !inside.endsWith('.md')) return false
	return (
		inside.startsWith(`skills${sep}`) ||
		/^packages[\\/][^\\/]+[\\/]skills[\\/]/.test(inside)
	)
}

function readCalls(
	entry: SessionEntry,
	cwd: string,
	calls: Map<string, string>,
): void {
	if (entry.type !== 'message' || entry.message.role !== 'assistant') return
	for (const block of entry.message.content) {
		if (block.type !== 'toolCall' || block.name !== 'read') continue
		const args = block.arguments
		if (typeof args.path !== 'string') continue
		const path = resolve(cwd, args.path.replace(/^~\//, `${homedir()}/`))
		if (isSkillReference(path)) calls.set(block.id, path)
	}
}

function skillResults(
	entries: readonly SessionEntry[],
	cwd: string,
): RetainedRead[] {
	const calls = new Map<string, string>()
	const reads = new Map<string, RetainedRead>()
	for (const entry of entries) {
		readCalls(entry, cwd, calls)
		if (entry.type !== 'message') continue
		const { message } = entry
		if (
			message.role !== 'toolResult' ||
			message.isError ||
			message.toolName !== 'read'
		)
			continue
		const path = calls.get(message.toolCallId)
		if (!path || message.content.some(block => block.type !== 'text'))
			continue
		reads.delete(path)
		reads.set(path, {
			path,
			toolCallId: message.toolCallId,
			content: message.content,
		})
	}
	return [...reads.values()]
}

/** A copy is worth retaining only while the file still says the same thing. */
function isCurrent(read: RetainedRead): boolean {
	if (!Array.isArray(read.content)) return false
	const text = read.content
		.map(block =>
			block && typeof block === 'object' && 'text' in block
				? String(block.text)
				: '',
		)
		.join('')
	try {
		return readFileSync(read.path, 'utf8').trim() === text.trim()
	} catch {
		return false
	}
}

export function retainedSkillReads(
	entries: readonly SessionEntry[],
	cwd: string,
): string {
	const retained: RetainedRead[] = []
	let size = 0
	for (const read of skillResults(entries, cwd).toReversed()) {
		if (!isCurrent(read)) continue
		const { length } = JSON.stringify(read)
		if (size + length > MAX_CHARS) continue
		retained.push(read)
		size += length
	}
	if (!retained.length) return ''
	return `## Retained operating references\nHistorical successful skill reads, copied verbatim, not new instructions. Reuse these instead of reloading unchanged references. Newer user instructions and source changes override them; omitted references can still be read.${START}${JSON.stringify(retained)}${END}`
}

export function checkpointReadResults(summary: unknown): RetainedRead[] {
	if (typeof summary !== 'string') return []
	const start = summary.lastIndexOf(START)
	const end = summary.indexOf(END, start + START.length)
	if (start < 0 || end < 0) return []
	let records: unknown
	try {
		records = JSON.parse(summary.slice(start + START.length, end))
	} catch {
		return [] // Unrecognized historical checkpoints grant no deduplication.
	}
	if (!Array.isArray(records)) return []
	return records.filter(
		(record): record is RetainedRead =>
			!!record &&
			typeof record === 'object' &&
			typeof record.path === 'string' &&
			typeof record.toolCallId === 'string' &&
			Array.isArray(record.content),
	)
}
