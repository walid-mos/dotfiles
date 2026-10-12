/**
 * Pi's grep spawns ripgrep locally whatever its operations, so a search under
 * the anchor runs `rg --json` on the Boat and is rendered in Pi's grep format:
 * `path:line: text` for matches, `path-line- text` for context.
 */
import { basename, dirname } from 'node:path'

import { quote } from '#lib/runtime/remote.ts'

import type { createGrepToolDefinition } from '@earendil-works/pi-coding-agent'
import type { Runtime } from '#lib/runtime/runtime.ts'

type GrepDefinition = ReturnType<typeof createGrepToolDefinition>
type GrepInput = Parameters<GrepDefinition['execute']>[1]

const DEFAULT_LIMIT = 100
const MAX_LINE_CHARS = 500
const MAX_OUTPUT_BYTES = 51_200
const MAX_JSON_LINES = 20_000
const NO_MATCH_EXIT = 1

type GrepLine = {
	kind: 'match' | 'context'
	path: string
	line: number
	text: string
}

export function remoteGrep(
	local: GrepDefinition,
	runtime: Runtime,
): GrepDefinition {
	return {
		...local,
		execute: async (...args) => {
			const [, input, , , ctx] = args
			const searchPath = input.path
				? resolvePath(ctx.cwd, input.path)
				: ctx.cwd
			const stats = await runtime.stat(searchPath)
			const directory = stats.isFile ? dirname(searchPath) : searchPath
			const files = stats.isFile ? [basename(searchPath)] : []
			const search = await runtime.run(command(input, files), directory)
			if (search.exitCode === NO_MATCH_EXIT)
				return {
					content: [{ type: 'text', text: 'No matches found' }],
					details: undefined,
				}
			if (search.exitCode !== 0)
				throw new Error(
					search.stderr.trim() || `rg exited with ${search.exitCode}`,
				)
			return render(parse(search.stdout), input.limit ?? DEFAULT_LIMIT)
		},
	}
}

function resolvePath(cwd: string, requested: string): string {
	if (requested.startsWith('/')) return requested
	return `${cwd}/${requested}`
}

function command(input: GrepInput, files: string[]): string {
	const flags = [
		'--json',
		input.ignoreCase ? '--ignore-case' : '',
		input.literal ? '--fixed-strings' : '',
		input.context ? `--context ${Math.trunc(input.context)}` : '',
		input.glob ? `--glob ${quote(input.glob)}` : '',
	].filter(Boolean)
	const target = files.map(file => ` -- ${quote(file)}`).join('')
	return `rg ${flags.join(' ')} -e ${quote(input.pattern)}${target} | head -n ${MAX_JSON_LINES}`
}

function parse(stdout: string): GrepLine[] {
	return stdout.split('\n').flatMap(line => {
		if (!line) return []
		const event: unknown = JSON.parse(line)
		const kind: unknown = Reflect.get(Object(event), 'type')
		if (kind !== 'match' && kind !== 'context') return []
		const data: unknown = Reflect.get(Object(event), 'data')
		const path: unknown = Reflect.get(
			Object(Reflect.get(Object(data), 'path')),
			'text',
		)
		const text: unknown = Reflect.get(
			Object(Reflect.get(Object(data), 'lines')),
			'text',
		)
		const lineNumber: unknown = Reflect.get(Object(data), 'line_number')
		if (
			typeof path !== 'string' ||
			typeof text !== 'string' ||
			typeof lineNumber !== 'number'
		)
			return []
		return [
			{
				kind,
				path: path.replace(/^\.\//, ''),
				line: lineNumber,
				text: text.replace(/\r?\n$/, ''),
			},
		]
	})
}

function render(
	lines: GrepLine[],
	limit: number,
): Awaited<ReturnType<GrepDefinition['execute']>> {
	const kept: string[] = []
	let matches = 0
	let bytes = 0
	let isLineTruncated = false
	for (const grepLine of lines) {
		if (grepLine.kind === 'match' && matches >= limit) break
		if (grepLine.kind === 'match') matches += 1
		const isLong = grepLine.text.length > MAX_LINE_CHARS
		isLineTruncated ||= isLong
		const text = isLong
			? `${grepLine.text.slice(0, MAX_LINE_CHARS)}…`
			: grepLine.text
		const separator = grepLine.kind === 'match' ? ':' : '-'
		const rendered = `${grepLine.path}${separator}${grepLine.line}${separator} ${text}`
		bytes += Buffer.byteLength(rendered) + 1
		if (bytes > MAX_OUTPUT_BYTES) break
		kept.push(rendered)
	}
	const isLimited =
		lines.filter(grepLine => grepLine.kind === 'match').length > matches
	const notes = isLimited
		? [`\n[Showing first ${matches} matches. Use limit to see more.]`]
		: []
	return {
		content: [
			{ type: 'text', text: `${kept.join('\n')}${notes.join('')}` },
		],
		details: {
			...(isLimited && { matchLimitReached: limit }),
			...(isLineTruncated && { linesTruncated: true }),
		},
	}
}
