/**
 * The default scope mode: what "my changes" means without flags. A branch
 * with commits beyond its mother branch diffs against the merge base, the
 * working-tree state included, so uncommitted edits stay in scope. A branch
 * sitting on its base (or with no candidate base) falls back to HEAD, with
 * the last-commit shortcut when the tree is clean.
 */

import { baseBranch } from './base-branch.ts'
import { addUntracked, diffFiles, headParents } from './git-diff.ts'

import type { ScopeSelection } from './git-files.ts'

export async function selectWorktree(
	repoRoot: string,
	filters: readonly string[],
): Promise<ScopeSelection> {
	const parents = await headParents(repoRoot)
	// No commit yet: the index is the only reference there is.
	if (!parents) return await selectUnborn(repoRoot, filters)
	const base = await baseBranch(repoRoot)
	if (base) {
		const { changed, dropped } = await diffFiles(
			repoRoot,
			[base.mergeBase],
			filters,
		)
		await addUntracked(repoRoot, changed, filters)
		return {
			label: `the branch against ${base.ref} (its merge base)`,
			changed,
			diffArgs: [base.mergeBase],
			dropped,
		}
	}
	return await selectAgainstHead(repoRoot, filters, parents.length)
}

async function selectUnborn(
	repoRoot: string,
	filters: readonly string[],
): Promise<ScopeSelection> {
	const { changed, dropped } = await diffFiles(
		repoRoot,
		['--cached'],
		filters,
	)
	await addUntracked(repoRoot, changed, filters)
	return {
		label: 'everything staged (there is no commit yet)',
		changed,
		diffArgs: ['--cached'],
		dropped,
	}
}

async function selectAgainstHead(
	repoRoot: string,
	filters: readonly string[],
	parentCount: number,
): Promise<ScopeSelection> {
	const { changed, dropped } = await diffFiles(repoRoot, ['HEAD'], filters)
	await addUntracked(repoRoot, changed, filters)
	if (changed.size === 0 && !filters.length && parentCount === 1) {
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
		label: 'the working tree against HEAD',
		changed,
		diffArgs: ['HEAD'],
		dropped,
	}
}
