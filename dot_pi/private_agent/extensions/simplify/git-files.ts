/**
 * Per-file facts: what a candidate file's diff actually changed, whether it is
 * even inspectable, and its content identity. Nothing here decides the scope -
 * `git-scope.ts` selects the candidates, this module describes them.
 */

import { stat } from 'node:fs/promises'
import path from 'node:path'

import { git, tryGit } from './git-shell.ts'
import {
	binaryPaths,
	mergeRanges,
	parseHunkRanges,
	parseNumstat,
	splitNul,
} from './scope-parse.ts'
import { mapSequential } from './sequential.ts'

import type { LineRange, ScopeStatus, SkippedFile } from './types.ts'

const HASH_CHUNK = 64
const BYTES_PER_MIB = 1_048_576

export const MAX_FILE_BYTES = 5_242_880

/** A candidate as the selection describes it, before the file is inspected. */
export interface SelectedFile {
	status: ScopeStatus
	isWholeFile: boolean
}

export interface SelectedScope {
	changed: Map<string, SelectedFile>
	/** Arguments after `git diff` that reproduce the scope; absent for a snapshot. */
	diffArgs?: readonly string[]
}

/** A resolved scope, before the per-file facts are inspected. */
export interface ScopeSelection extends SelectedScope {
	label: string
	dropped: SkippedFile[]
}

/** What one `git diff` call found, plus the candidates it had to drop. */
export interface DiffSelection {
	changed: Map<string, SelectedFile>
	dropped: SkippedFile[]
}

export interface InspectedFile {
	path: string
	status: ScopeStatus
	isWholeFile: boolean
	ranges: LineRange[]
}

export type InspectResult =
	| { kind: 'file'; file: InspectedFile }
	| { kind: 'skip'; skipped: SkippedFile }

export interface InspectOutcome {
	files: InspectedFile[]
	skipped: SkippedFile[]
}

interface InspectInput {
	repoRoot: string
	relative: string
	selected: SelectedFile
	diffArgs: readonly string[] | undefined
	binaries: ReadonlySet<string>
	submodules: ReadonlySet<string>
}

export async function inspectFiles(
	repoRoot: string,
	candidates: readonly string[],
	scope: SelectedScope,
): Promise<InspectOutcome> {
	const binaries = await binaryFiles(repoRoot, scope.diffArgs, candidates)
	const submodules = await submoduleFiles(repoRoot, candidates)
	const results = await mapSequential(candidates, relative => {
		const selected = scope.changed.get(relative)
		if (!selected)
			return Promise.resolve<InspectResult | undefined>(undefined)
		return inspectFile({
			repoRoot,
			relative,
			selected,
			diffArgs: scope.diffArgs,
			binaries,
			submodules,
		})
	})
	return {
		files: results.flatMap(inspected =>
			inspected?.kind === 'file' ? [inspected.file] : [],
		),
		skipped: results.flatMap(inspected =>
			inspected?.kind === 'skip' ? [inspected.skipped] : [],
		),
	}
}

async function inspectFile(input: InspectInput): Promise<InspectResult> {
	const { repoRoot, relative, selected } = input
	if (input.submodules.has(relative)) return skip(relative, 'submodule')
	if (input.binaries.has(relative)) return skip(relative, 'binary file')
	const stats = await fileStats(path.join(repoRoot, relative))
	if (!stats?.isFile()) return skip(relative, 'not a readable regular file')
	if (stats.size > MAX_FILE_BYTES)
		return skip(relative, `larger than ${formatBytes(MAX_FILE_BYTES)}`)
	const ranges = await fileRanges(input)
	if (!selected.isWholeFile && !ranges.length)
		return skip(relative, 'no line was added or changed')
	return {
		kind: 'file',
		file: {
			path: relative,
			status: selected.status,
			isWholeFile: selected.isWholeFile,
			ranges,
		},
	}
}

function skip(relative: string, reason: string): InspectResult {
	return { kind: 'skip', skipped: { path: relative, reason } }
}

async function fileRanges(input: InspectInput): Promise<LineRange[]> {
	const { diffArgs } = input
	if (input.selected.isWholeFile || !diffArgs) return []
	const stdout = await git(input.repoRoot, [
		'diff',
		'--unified=0',
		'--no-ext-diff',
		'--no-color',
		...diffArgs,
		'--',
		input.relative,
	])
	return mergeRanges(parseHunkRanges(stdout))
}

export async function fileStats(
	absolute: string,
): Promise<Awaited<ReturnType<typeof stat>> | undefined> {
	try {
		return await stat(absolute)
	} catch {
		return undefined
	}
}

/** Content identity through git itself, with a size/mtime token as the fallback. */
export async function fileHash(absolute: string, cwd: string): Promise<string> {
	const blob = await tryGit(cwd, ['hash-object', '--', absolute])
	if (blob?.trim()) return `blob ${blob.trim()}`
	const stats = await fileStats(absolute)
	if (!stats?.isFile()) return 'missing'
	return `stat ${stats.size} ${Math.round(Number(stats.mtimeMs))}`
}

export async function hashFiles(
	repoRoot: string,
	relatives: readonly string[],
): Promise<string[]> {
	const chunks = chunked(relatives, HASH_CHUNK)
	const groups = await mapSequential(chunks, chunk =>
		hashChunk(repoRoot, chunk),
	)
	return groups.flat()
}

async function hashChunk(
	repoRoot: string,
	relatives: readonly string[],
): Promise<string[]> {
	const absolute = relatives.map(relative => path.join(repoRoot, relative))
	const batch = await tryGit(repoRoot, ['hash-object', '--', ...absolute])
	const lines = batch?.split('\n').filter(line => line.length > 0) ?? []
	// The same prefix fileHash() uses: one content identity, wherever it came from.
	if (lines.length === relatives.length)
		return lines.map(line => `blob ${line}`)
	return await mapSequential(absolute, one => fileHash(one, repoRoot))
}

/** Current hashes for a set of repo-relative paths, for the staleness checks. */
export async function hashManifestFiles(
	repoRoot: string,
	relatives: readonly string[],
): Promise<Map<string, string>> {
	const hashes = await hashFiles(repoRoot, relatives)
	const byPath = new Map<string, string>()
	relatives.forEach((relative, index) => {
		byPath.set(relative, hashes[index] ?? 'missing')
	})
	return byPath
}

async function binaryFiles(
	repoRoot: string,
	diffArgs: readonly string[] | undefined,
	paths: readonly string[],
): Promise<Set<string>> {
	if (!diffArgs || !paths.length) return new Set()
	const stdout = await git(repoRoot, [
		'diff',
		'--numstat',
		'-z',
		...diffArgs,
		'--',
		...paths,
	])
	return binaryPaths(parseNumstat(stdout))
}

async function submoduleFiles(
	repoRoot: string,
	paths: readonly string[],
): Promise<Set<string>> {
	if (!paths.length) return new Set()
	const stdout = await git(repoRoot, ['ls-files', '-s', '-z', '--', ...paths])
	const submodules = new Set<string>()
	for (const row of splitNul(stdout)) {
		const tab = row.indexOf('\t')
		if (tab === -1) continue
		const [mode = ''] = row.slice(0, tab).split(/\s+/u)
		if (mode === SUBMODULE_MODE) submodules.add(row.slice(tab + 1))
	}
	return submodules
}

const SUBMODULE_MODE = '160000'

function chunked<T>(items: readonly T[], size: number): T[][] {
	const chunks: T[][] = []
	for (let start = 0; start < items.length; start += size)
		chunks.push(items.slice(start, start + size))
	return chunks
}

function formatBytes(bytes: number): string {
	return `${Math.round(bytes / BYTES_PER_MIB)} MiB`
}
