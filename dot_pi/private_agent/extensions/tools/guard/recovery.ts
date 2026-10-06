/**
 * Make a failed `edit` or `read` recoverable in one retry: the error keeps
 * its text and gains the evidence the model otherwise spends a round trip on.
 * edit "could not find": the current lines around the nearest match of the
 * missing text. read ENOENT: the nearest existing directory and its entries.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'

import type {
	ExtensionAPI,
	ToolResultEventResult,
} from '@earendil-works/pi-coding-agent'

const CONTEXT_LINES = 3
const MAX_ENTRIES = 24
const MAX_FILE_BYTES = 2_000_000
const MIN_PREFIX = 12
const MAX_MATCH_LINES = 12
const HALF = 2
const LINE_NUMBER_WIDTH = 5

function textOf(content: readonly { type: string; text?: string }[]): string {
	return content
		.flatMap(part => (part.type === 'text' && part.text ? [part.text] : []))
		.join('\n')
}

function withHint(
	content: ToolResultEventResult['content'] & object,
	hint: string,
): ToolResultEventResult {
	return { content: [...content, { type: 'text', text: `\n${hint}` }] }
}

/** The `oldText` of the edit the error names, or the first one. */
function missingText(input: Record<string, unknown>, error: string): string {
	const index = Number(/edits\[(\d+)\]/.exec(error)?.[1] ?? 0)
	const { edits } = input
	const edit = Array.isArray(edits) ? edits[index] : undefined
	const candidate =
		edit && typeof edit === 'object'
			? Reflect.get(edit, 'oldText')
			: input.oldText
	return typeof candidate === 'string' ? candidate : ''
}

function nearestLine(lines: readonly string[], probe: string): number {
	const needle = probe.trim()
	if (!needle) return -1
	const exact = lines.findIndex(line => line.trim() === needle)
	if (exact !== -1) return exact
	const prefix = needle.slice(
		0,
		Math.max(MIN_PREFIX, Math.floor(needle.length / HALF)),
	)
	return lines.findIndex(line => line.includes(prefix))
}

function editHint(
	input: Record<string, unknown>,
	error: string,
): string | undefined {
	const path = typeof input.path === 'string' ? input.path : ''
	const missing = missingText(input, error)
	if (!path || !missing || !existsSync(path)) return undefined
	if (statSync(path).size > MAX_FILE_BYTES) return undefined
	const lines = readFileSync(path, 'utf8').split('\n')
	const probes = missing.split('\n').filter(line => line.trim())
	const [first] = probes
	if (!first) return undefined
	const at = nearestLine(lines, first)
	if (at === -1)
		return `No line of the missing oldText occurs in ${path}; re-read the region before retrying.`
	const from = Math.max(0, at - CONTEXT_LINES)
	const to = Math.min(
		lines.length,
		at + Math.min(probes.length, MAX_MATCH_LINES) + CONTEXT_LINES,
	)
	const numbered = lines
		.slice(from, to)
		.map(
			(line, offset) =>
				`${String(from + offset + 1).padStart(LINE_NUMBER_WIDTH)}  ${line}`,
		)
		.join('\n')
	return `Nearest match for the missing oldText in ${path} at line ${at + 1}; current text, numbered:\n${numbered}\nCopy oldText from these lines exactly.`
}

function readHint(
	cwd: string,
	input: Record<string, unknown>,
): string | undefined {
	const requested = typeof input.path === 'string' ? input.path : ''
	if (!requested) return undefined
	let directory = dirname(resolve(cwd, requested))
	while (!existsSync(directory)) {
		const parent = dirname(directory)
		if (parent === directory) return undefined
		directory = parent
	}
	let entries: string[]
	try {
		entries = readdirSync(directory, { withFileTypes: true }).map(entry =>
			entry.isDirectory() ? `${entry.name}/` : entry.name,
		)
	} catch {
		return undefined
	}
	const stem = basename(requested)
		.toLowerCase()
		.replace(/\.[^.]+$/, '')
	const similar = stem
		? entries.filter(entry => entry.toLowerCase().includes(stem))
		: []
	const listed = entries.slice(0, MAX_ENTRIES).join(', ')
	const more =
		entries.length > MAX_ENTRIES
			? `, … ${entries.length - MAX_ENTRIES} more`
			: ''
	return `Path does not exist. Nearest existing directory: ${directory}${similar.length ? ` (similar: ${similar.join(', ')})` : ''}. Entries: ${listed}${more}.`
}

export function registerLookupRecovery(pi: ExtensionAPI): void {
	pi.on('tool_result', (event, ctx) => {
		if (!event.isError) return undefined
		const error = textOf(event.content)
		let hint: string | undefined
		if (event.toolName === 'edit' && /could not find/i.test(error))
			hint = editHint(event.input, error)
		if (event.toolName === 'read' && /ENOENT/.test(error))
			hint = readHint(ctx.cwd, event.input)
		if (!hint) return undefined
		return withHint(event.content, hint)
	})
}
