/**
 * The git reads every diff-based scope mode shares: HEAD's parents, the
 * name-status diff of a revision expression, and the untracked files. The
 * per-mode policies live beside them (git-selection.ts, worktree.ts).
 */

import { git, tryGit } from './git-shell.ts'
import { parseNameStatus, splitNul, statusFromCode } from './scope-parse.ts'

import type { DiffSelection, SelectedFile } from './git-files.ts'
import type { SkippedFile } from './types.ts'

/** Parents of HEAD, or undefined when HEAD does not exist (an unborn branch). */
export async function headParents(
	repoRoot: string,
): Promise<string[] | undefined> {
	const line = await tryGit(repoRoot, [
		'rev-list',
		'--parents',
		'-n',
		'1',
		'HEAD',
	])
	if (!line) return undefined
	const [, ...parents] = line.trim().split(/\s+/u)
	return parents
}

/** Which paths a `git diff <args>` touches, added/copied whole, plus deletions dropped. */
export async function diffFiles(
	repoRoot: string,
	diffArgs: readonly string[],
	filters: readonly string[],
): Promise<DiffSelection> {
	const stdout = await git(repoRoot, [
		'diff',
		'--name-status',
		'-z',
		...diffArgs,
		'--',
		...filters,
	])
	const changed = new Map<string, SelectedFile>()
	const dropped: SkippedFile[] = []
	for (const entry of parseNameStatus(stdout)) {
		const status = statusFromCode(entry.code)
		if (!status) {
			dropped.push({ path: entry.path, reason: 'deleted' })
			continue
		}
		changed.set(entry.path, {
			status,
			isWholeFile: status === 'added' || status === 'copied',
		})
	}
	return { changed, dropped }
}

/** Untracked paths are always whole-file scope, merged over a diff selection. */
export async function addUntracked(
	repoRoot: string,
	changed: Map<string, SelectedFile>,
	filters: readonly string[],
): Promise<void> {
	const stdout = await git(repoRoot, [
		'ls-files',
		'--others',
		'--exclude-standard',
		'-z',
		'--',
		...filters,
	])
	for (const relative of splitNul(stdout)) {
		if (changed.has(relative)) continue
		changed.set(relative, { status: 'untracked', isWholeFile: true })
	}
}
