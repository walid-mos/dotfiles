/**
 * The --snapshot scope: no diff, every named file wholly in scope. A path that
 * is missing or outside the repository refuses the run instead of silently
 * dropping out of the scope.
 */

import { realpath } from 'node:fs/promises'
import path from 'node:path'

import { fileStats } from './git-files.ts'
import { ScopeError } from './git-shell.ts'
import { mapSequential } from './sequential.ts'

import type { SelectedFile, ScopeSelection } from './git-files.ts'

const PARENT_PREFIX = '..'

export async function selectSnapshot(
	repoRoot: string,
	paths: readonly string[],
	cwd: string,
): Promise<ScopeSelection> {
	const changed = new Map<string, SelectedFile>()
	const pathsInRepo = await mapSequential(paths, raw =>
		resolveSnapshot(repoRoot, cwd, raw),
	)
	for (const relative of pathsInRepo)
		changed.set(relative, { status: 'modified', isWholeFile: true })
	if (!changed.size)
		throw new ScopeError('--snapshot needs at least one file.')
	return {
		label: `a snapshot of ${changed.size} file(s)`,
		changed,
		dropped: [],
	}
}

/** The repo-relative path of one --snapshot argument, or a refusal to run. */
async function resolveSnapshot(
	repoRoot: string,
	cwd: string,
	raw: string,
): Promise<string> {
	// git reports the real path, while a session cwd may cross a symlink
	// (/tmp and /var are symlinked on macOS): compare the resolved paths.
	const absolute = await resolved(path.resolve(cwd, raw))
	const relative = path.relative(repoRoot, absolute)
	if (
		!relative ||
		relative.startsWith(PARENT_PREFIX) ||
		path.isAbsolute(relative)
	)
		throw new ScopeError(`${raw} is outside ${repoRoot}.`)
	const stats = await fileStats(absolute)
	if (!stats?.isFile()) throw new ScopeError(`${raw} is not a readable file.`)
	return relative
}

async function resolved(absolute: string): Promise<string> {
	try {
		return await realpath(absolute)
	} catch {
		// A missing file still has a real parent: canonicalize the directory.
		try {
			const parent = await realpath(path.dirname(absolute))
			return path.join(parent, path.basename(absolute))
		} catch {
			return absolute
		}
	}
}
