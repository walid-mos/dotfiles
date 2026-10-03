/**
 * Which files a run may look at, per diff-based scope mode: the dispatch and
 * the explicit modes (--staged, --last, --ref, a bare target, --files). The
 * per-file facts (ranges, size, hash) come from `git-files.ts`, the default
 * branch-delta policy from `worktree.ts`, and the shared git reads from
 * `git-diff.ts`.
 */

import { addUntracked, diffFiles, headParents } from './git-diff.ts'
import { git, ScopeError, tryGit } from './git-shell.ts'
import { selectSnapshot, selectTarget } from './git-snapshot.ts'
import { splitNul } from './scope-parse.ts'
import { selectWorktree } from './worktree.ts'

import type { ScopeSelection } from './git-files.ts'
import type { ScopeMode } from './types.ts'

const REVISION_EXPRESSION = '..'

export async function resolveRepoRoot(cwd: string): Promise<string> {
	const top = await tryGit(cwd, ['rev-parse', '--show-toplevel'])
	const root = top?.trim()
	if (!root) throw new ScopeError('Not inside a git repository.')
	return root
}

/** Both the index and the working tree: an unmerged path has no scope to analyse. */
export async function assertNoConflicts(repoRoot: string): Promise<void> {
	const conflicts = new Set([
		...splitNul(
			await git(repoRoot, [
				'diff',
				'--diff-filter=U',
				'-z',
				'--name-only',
			]),
		),
		...splitNul(
			await git(repoRoot, [
				'diff',
				'--cached',
				'--diff-filter=U',
				'-z',
				'--name-only',
			]),
		),
	])
	if (!conflicts.size) return
	throw new ScopeError(
		`Unmerged files must be resolved first: ${[...conflicts].join(', ')}.`,
	)
}

export async function selectFiles(
	workspaceRoot: string,
	mode: ScopeMode,
	filters: readonly string[],
	cwd: string,
): Promise<ScopeSelection> {
	switch (mode.kind) {
		case 'worktree':
			return await selectWorktree(workspaceRoot, filters)
		case 'staged':
			return await selectStaged(workspaceRoot, filters)
		case 'last':
			return await selectLast(workspaceRoot, filters)
		case 'ref':
			return await selectRef(workspaceRoot, mode.ref, filters)
		case 'target':
			return await selectTarget(workspaceRoot, mode.query, cwd)
		case 'snapshot':
			return await selectSnapshot(workspaceRoot, mode.paths, cwd)
		default:
			throw new ScopeError('Unsupported scope mode.')
	}
}

async function selectStaged(
	repoRoot: string,
	filters: readonly string[],
): Promise<ScopeSelection> {
	const { changed, dropped } = await diffFiles(
		repoRoot,
		['--cached'],
		filters,
	)
	const unstaged = new Set(
		splitNul(
			await git(repoRoot, [
				'diff',
				'--name-only',
				'-z',
				'--',
				...filters,
			]),
		),
	)
	for (const relative of Array.from(changed.keys())) {
		if (!unstaged.has(relative)) continue
		changed.delete(relative)
		dropped.push({ path: relative, reason: 'has unstaged changes too' })
	}
	return {
		label: 'the staged changes',
		changed,
		diffArgs: ['--cached'],
		dropped,
	}
}

async function selectLast(
	repoRoot: string,
	filters: readonly string[],
): Promise<ScopeSelection> {
	const parents = await headParents(repoRoot)
	if (!parents)
		throw new ScopeError(
			'There is no commit yet, so there is no last commit.',
		)
	if (!parents.length)
		throw new ScopeError(
			'HEAD is the root commit: there is no previous commit to compare with.',
		)
	if (parents.length > 1)
		throw new ScopeError(
			'HEAD is a merge commit: name its base with --ref <ref> instead of --last.',
		)
	const { changed, dropped } = await diffFiles(
		repoRoot,
		['HEAD~1..HEAD'],
		filters,
	)
	return {
		label: 'the last commit (HEAD)',
		changed,
		diffArgs: ['HEAD~1..HEAD'],
		dropped,
	}
}

async function selectRef(
	repoRoot: string,
	ref: string,
	filters: readonly string[],
): Promise<ScopeSelection> {
	if (ref.includes(REVISION_EXPRESSION))
		throw new ScopeError(
			`${ref} is a revision expression; name a single ref (for example main).`,
		)
	const resolved = await tryGit(repoRoot, [
		'rev-parse',
		'--verify',
		'-q',
		`${ref}^{commit}`,
	])
	if (!resolved)
		throw new ScopeError(
			`${ref} does not name a commit in this repository.`,
		)
	const { changed, dropped } = await diffFiles(repoRoot, [ref], filters)
	await addUntracked(repoRoot, changed, filters)
	return {
		label: `the changes against ${ref}`,
		changed,
		diffArgs: [ref],
		dropped,
	}
}
