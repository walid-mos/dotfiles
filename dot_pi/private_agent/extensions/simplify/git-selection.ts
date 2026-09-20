/**
 * Which files a run may look at, per diff-based scope mode. The policy lives
 * here; the per-file facts (ranges, size, hash) come from `git-files.ts` and
 * the --snapshot mode from `git-snapshot.ts`.
 */

import { git, ScopeError, tryGit } from './git-shell.ts'
import { selectSnapshot } from './git-snapshot.ts'
import { parseNameStatus, splitNul, statusFromCode } from './scope-parse.ts'

import type {
	DiffSelection,
	ScopeSelection,
	SelectedFile,
} from './git-files.ts'
import type { ScopeMode, SkippedFile } from './types.ts'

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

/** Parents of HEAD, or undefined when HEAD does not exist (an unborn branch). */
async function headParents(repoRoot: string): Promise<string[] | undefined> {
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

export async function selectFiles(
	repoRoot: string,
	mode: ScopeMode,
	filters: readonly string[],
	cwd: string,
): Promise<ScopeSelection> {
	switch (mode.kind) {
		case 'worktree':
			return await selectWorktree(repoRoot, filters)
		case 'staged':
			return await selectStaged(repoRoot, filters)
		case 'last':
			return await selectLast(repoRoot, filters)
		case 'ref':
			return await selectRef(repoRoot, mode.ref, filters)
		case 'snapshot':
			return await selectSnapshot(repoRoot, mode.paths, cwd)
		default:
			throw new ScopeError('Unsupported scope mode.')
	}
}

async function selectWorktree(
	repoRoot: string,
	filters: readonly string[],
): Promise<ScopeSelection> {
	const parents = await headParents(repoRoot)
	// No commit yet: the index is the only reference there is.
	const diffArgs = parents ? ['HEAD'] : ['--cached']
	const { changed, dropped } = await diffFiles(repoRoot, diffArgs, filters)
	await addUntracked(repoRoot, changed, filters)
	if (changed.size === 0 && !filters.length && parents?.length === 1) {
		// A clean tree right after a commit: the last commit is what "my changes" means.
		const fallback = await diffFiles(repoRoot, ['HEAD~1..HEAD'], [])
		return {
			label: 'the last commit (the working tree is clean)',
			changed: fallback.changed,
			diffArgs: ['HEAD~1..HEAD'],
			dropped: fallback.dropped,
		}
	}
	return {
		label: parents
			? 'the working tree against HEAD'
			: 'everything staged (there is no commit yet)',
		changed,
		diffArgs,
		dropped,
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

async function diffFiles(
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

async function addUntracked(
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
