/**
 * Pure parsing of git's own output: name-status rows, `--unified=0` hunk
 * headers and numstat rows. No process is started here and no repository is
 * read - `git-scope.ts` supplies the text.
 */

import type { LineRange, ScopeStatus } from './types.ts'

/** One `--name-status` row, still carrying git's own status letter. */
export interface NameStatusEntry {
	code: string
	path: string
	from?: string
}

export interface NumstatEntry {
	added: number
	removed: number
	/** git prints `-` for both counts on a binary file. */
	isBinary: boolean
	path: string
	from?: string
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/
const FIELD_SEPARATOR = '\t'
const NUL = '\0'
const RENAMED_CODE = 'R'
const COPIED_CODE = 'C'
const RENAME_CODES = [RENAMED_CODE, COPIED_CODE]
const RENAME_FIELDS = 2
const ADDED_CODE = 'A'
const DELETED_CODE = 'D'
const UNTRACKED_CODE = '?'
const BINARY_MARKER = '-'

/** `git diff --name-status -z` (NUL rows) and the tab/newline form. */
export function parseNameStatus(stdout: string): NameStatusEntry[] {
	if (!stdout) return []
	if (stdout.includes(NUL)) return parseNameStatusNul(stdout.split(NUL))
	return parseNameStatusLines(stdout.split('\n'))
}

function parseNameStatusNul(fields: readonly string[]): NameStatusEntry[] {
	const entries: NameStatusEntry[] = []
	let index = 0
	while (index < fields.length) {
		const code = (fields[index] ?? '').trim()
		index += 1
		if (!code) continue
		const entry = nameStatusFrom(code, fields[index], fields[index + 1])
		index += isRenameCode(code) ? RENAME_FIELDS : 1
		if (!entry) break
		entries.push(entry)
	}
	return entries
}

function parseNameStatusLines(lines: readonly string[]): NameStatusEntry[] {
	const entries: NameStatusEntry[] = []
	for (const line of lines) {
		if (!line.trim()) continue
		const parts = line.includes(FIELD_SEPARATOR)
			? line.split(FIELD_SEPARATOR)
			: line.split(/\s+/u)
		const [code = '', first, second] = parts
		const entry = nameStatusFrom(code.trim(), first, second)
		if (entry) entries.push(entry)
	}
	return entries
}

function isRenameCode(code: string): boolean {
	return RENAME_CODES.some(prefix => code.startsWith(prefix))
}

function nameStatusFrom(
	code: string,
	first: string | undefined,
	second: string | undefined,
): NameStatusEntry | undefined {
	if (typeof first !== 'string') return undefined
	if (!(typeof second === 'string' && isRenameCode(code)))
		return { code, path: first }
	return { code, from: first, path: second }
}

/** The scope status a raw code stands for; undefined means "not in scope". */
export function statusFromCode(code: string): ScopeStatus | undefined {
	switch (code.charAt(0)) {
		case ADDED_CODE:
			return 'added'
		case COPIED_CODE:
			return 'copied'
		case DELETED_CODE:
			return undefined
		case RENAMED_CODE:
			return 'renamed'
		case UNTRACKED_CODE:
			return 'untracked'
		default:
			return 'modified'
	}
}

/** New-side line ranges of a `--unified=0` diff; a zero-length hunk is a deletion. */
export function parseHunkRanges(diffText: string): LineRange[] {
	const ranges: LineRange[] = []
	for (const line of diffText.split('\n')) {
		const match = HUNK_HEADER.exec(line)
		if (!match) continue
		const [, startText, countText] = match
		const start = Number(startText ?? '')
		const count = countText ? Number(countText) : 1
		if (!Number.isFinite(start) || count <= 0) continue
		ranges.push({ start, end: start + count - 1 })
	}
	return ranges
}

/** Sort and fold overlapping *and* adjacent ranges into one list. */
export function mergeRanges(ranges: readonly LineRange[]): LineRange[] {
	const sorted = ranges.toSorted(
		(left, right) => left.start - right.start || left.end - right.end,
	)
	const merged: LineRange[] = []
	for (const range of sorted) foldRange(merged, range)
	return merged
}

function foldRange(merged: LineRange[], range: LineRange): void {
	const last = merged.at(-1)
	if (!last || range.start > last.end + 1) {
		merged.push({ start: range.start, end: range.end })
		return
	}
	if (range.end > last.end) last.end = range.end
}

/** `git diff --numstat -z` (NUL rows) and the tab/newline form. */
export function parseNumstat(stdout: string): NumstatEntry[] {
	if (!stdout) return []
	if (stdout.includes(NUL)) return parseNumstatNul(stdout.split(NUL))
	return parseNumstatLines(stdout.split('\n'))
}

function parseNumstatNul(fields: readonly string[]): NumstatEntry[] {
	const entries: NumstatEntry[] = []
	let index = 0
	while (index < fields.length) {
		const row = fields[index] ?? ''
		index += 1
		if (!row.trim()) continue
		const entry = numstatRow(row, fields, index)
		if (!entry) break
		index += entry.isRename ? RENAME_FIELDS : 0
		entries.push(entry.entry)
	}
	return entries
}

/** One NUL numstat row: the path inline, or two fields later for a rename. */
function numstatRow(
	row: string,
	fields: readonly string[],
	index: number,
): { entry: NumstatEntry; isRename: boolean } | undefined {
	const [added = '', removed = '', path = ''] = row.split(FIELD_SEPARATOR)
	if (path)
		return {
			entry: numstatEntry(added, removed, path, undefined),
			isRename: false,
		}
	const [from, to] = [fields[index], fields[index + 1]]
	if (!from || !to) return undefined
	return { entry: numstatEntry(added, removed, to, from), isRename: true }
}

function parseNumstatLines(lines: readonly string[]): NumstatEntry[] {
	const entries: NumstatEntry[] = []
	for (const line of lines) {
		if (!line.trim()) continue
		const [added = '', removed = '', ...rest] = line.split(FIELD_SEPARATOR)
		if (!rest.length) continue
		entries.push(
			numstatEntry(added, removed, rest.join(FIELD_SEPARATOR), undefined),
		)
	}
	return entries
}

function numstatEntry(
	added: string,
	removed: string,
	path: string,
	from: string | undefined,
): NumstatEntry {
	const entry: NumstatEntry = {
		added: countOrZero(added),
		removed: countOrZero(removed),
		isBinary: added === BINARY_MARKER || removed === BINARY_MARKER,
		path,
	}
	if (!from) return entry
	return { ...entry, from }
}

/** git prints `-` instead of a count for a binary file. */
function countOrZero(text: string): number {
	if (text === BINARY_MARKER) return 0
	return Number(text)
}

/** Paths of the binary rows in a numstat report. */
export function binaryPaths(entries: readonly NumstatEntry[]): Set<string> {
	const paths = new Set<string>()
	for (const entry of entries) {
		if (entry.isBinary) paths.add(entry.path)
	}
	return paths
}

/** NUL-separated path list, as `-z` prints it. */
export function splitNul(stdout: string): string[] {
	return stdout.split(NUL).filter(part => part.length > 0)
}

/** `12-14, 30` - the human form of a range list. */
export function formatRanges(ranges: readonly LineRange[]): string {
	return ranges.map(formatRange).join(', ')
}

function formatRange(range: LineRange): string {
	if (range.start === range.end) return `${range.start}`
	return `${range.start}-${range.end}`
}
