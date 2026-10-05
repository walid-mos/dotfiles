/** Exact, bounded skill reads kept outside the lossy checkpoint summary. */
import { homedir } from 'node:os'
import { join, relative, resolve } from 'node:path'

import { getAgentDir } from '@earendil-works/pi-coding-agent'

import type { SessionEntry } from '@earendil-works/pi-coding-agent'

const START = '\n<retained-skill-reads>\n'
const END = '\n</retained-skill-reads>'
const MAX_CHARS = 32_000

type RetainedRead = { path: string; toolCallId: string; content: unknown }

function readCalls(
	entry: SessionEntry,
	cwd: string,
	calls: Map<string, string>,
): void {
	if (entry.type !== 'message' || entry.message.role !== 'assistant') return
	const skills = join(getAgentDir(), 'skills')
	for (const block of entry.message.content) {
		if (block.type !== 'toolCall' || block.name !== 'read') continue
		const args = block.arguments
		if (typeof args.path !== 'string') continue
		const path = resolve(cwd, args.path.replace(/^~\//, `${homedir()}/`))
		const inside = relative(skills, path)
		if (!inside.startsWith('..') && inside.endsWith('.md'))
			calls.set(block.id, path)
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

export function retainedSkillReads(
	entries: readonly SessionEntry[],
	cwd: string,
): string {
	const retained: RetainedRead[] = []
	let size = 0
	for (const read of skillResults(entries, cwd).toReversed()) {
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
