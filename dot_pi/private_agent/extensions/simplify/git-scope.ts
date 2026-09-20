/**
 * Assembling the scope manifest: the selection from `git-selection.ts`, the
 * per-file facts from `git-files.ts`, and the caps that stop a run from
 * analysing a repository-sized change. A refusal is a `ScopeError` - never a
 * silent truncation.
 */

import { hashFiles, inspectFiles } from './git-files.ts'
import {
	assertNoConflicts,
	resolveRepoRoot,
	selectFiles,
} from './git-selection.ts'
import { ScopeError } from './git-shell.ts'

import type { InspectedFile, ScopeSelection } from './git-files.ts'
import type {
	ScopeFile,
	ScopeManifest,
	ScopeRequest,
	SkippedFile,
} from './types.ts'

export const MAX_SCOPE_FILES = 200
export const MAX_SCOPE_RANGES = 4096

export async function collectScope(
	cwd: string,
	request: ScopeRequest,
): Promise<ScopeManifest> {
	const repoRoot = await resolveRepoRoot(cwd)
	await assertNoConflicts(repoRoot)
	const selection = await selectFiles(
		repoRoot,
		request.mode,
		request.paths,
		cwd,
	)
	const candidates = [...selection.changed.keys()].toSorted()
	assertFileCount(candidates)
	const inspection = await inspectFiles(repoRoot, candidates, selection)
	assertRangeCount(inspection.files)
	return await assembleManifest(repoRoot, selection, inspection.files, [
		...selection.dropped,
		...inspection.skipped,
	])
}

async function assembleManifest(
	repoRoot: string,
	selection: ScopeSelection,
	inspected: readonly InspectedFile[],
	skipped: readonly SkippedFile[],
): Promise<ScopeManifest> {
	const hashes = await hashFiles(
		repoRoot,
		inspected.map(file => file.path),
	)
	const files: ScopeFile[] = inspected.map((file, index) => ({
		path: file.path,
		status: file.status,
		wholeFile: file.isWholeFile,
		ranges: file.ranges,
		hash: hashes[index] ?? 'missing',
	}))
	const manifest: ScopeManifest = {
		repoRoot,
		label: selection.label,
		files,
		skipped: [...skipped],
	}
	const diffCommand = diffCommandFor(repoRoot, selection.diffArgs)
	if (diffCommand) manifest.diffCommand = diffCommand
	return manifest
}

function assertFileCount(candidates: readonly string[]): void {
	if (candidates.length <= MAX_SCOPE_FILES) return
	throw new ScopeError(
		`The scope names ${candidates.length} files, more than the ${MAX_SCOPE_FILES} a single run analyses. Narrow it with paths, --staged or --ref.`,
	)
}

function assertRangeCount(files: readonly InspectedFile[]): void {
	const ranges = files.reduce((total, file) => total + file.ranges.length, 0)
	if (ranges <= MAX_SCOPE_RANGES) return
	throw new ScopeError(
		`The scope has ${ranges} changed line ranges, more than the ${MAX_SCOPE_RANGES} a single run analyses. Narrow it with paths or --staged.`,
	)
}

function diffCommandFor(
	repoRoot: string,
	diffArgs: readonly string[] | undefined,
): string | undefined {
	if (!diffArgs) return undefined
	return `git -C ${shellQuote(repoRoot)} diff ${diffArgs.join(' ')}`
}

function shellQuote(candidate: string): string {
	return /[^\w./:@-]/u.test(candidate)
		? `'${candidate.replaceAll("'", "'\\''")}'`
		: candidate
}
