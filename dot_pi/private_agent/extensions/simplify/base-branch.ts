/**
 * The mother branch that anchors the default scope. All probes run in
 * parallel and the most common name wins, so candidate order is policy, not
 * probe speed.
 */

import { tryGit } from './git-shell.ts'

/** Mother-branch candidates, most common name first. */
const CANDIDATES = ['main', 'master', 'origin/main', 'origin/master']

export interface BaseBranch {
	/** The candidate ref that resolved; named in the scope label. */
	ref: string
	/** The merge base of HEAD and the ref: the default scope's diff anchor. */
	mergeBase: string
}

export async function baseBranch(
	repoRoot: string,
): Promise<BaseBranch | undefined> {
	const head = (await tryGit(repoRoot, ['rev-parse', 'HEAD']))?.trim()
	const probed = await Promise.all(
		CANDIDATES.map(async candidate => {
			const sha = (
				await tryGit(repoRoot, [
					'rev-parse',
					'--verify',
					'-q',
					`${candidate}^{commit}`,
				])
			)?.trim()
			const mergeBase = (
				await tryGit(repoRoot, ['merge-base', 'HEAD', candidate])
			)?.trim()
			return { candidate, sha, mergeBase }
		}),
	)
	for (const { candidate, sha, mergeBase } of probed) {
		if (!sha || !mergeBase) continue
		// A merge base equal to HEAD means this candidate is not behind the
		// branch: sitting on the base, or the base moved ahead of HEAD. Either
		// way the branch adds nothing to diff against, so try the next one.
		if (sha !== head && mergeBase !== head)
			return { ref: candidate, mergeBase }
	}
	return undefined
}
