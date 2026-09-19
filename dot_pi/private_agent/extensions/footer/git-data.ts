// Git status and PR data collection. Runs outside the renderer: only
// polling code writes the caches these promises return.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { isRecord } from './json.ts'

const execFileAsync = promisify(execFile)

/** `git status` budget: slow repos degrade to null instead of hanging. */
const GIT_TIMEOUT_MS = 5000
/** `gh pr view` budget for cold gh CLI invocations. */
const PR_TIMEOUT_MS = 8000

export type GitStatus = {
	modified: number // unstaged modified
	staged: number // staged (added/modified/renamed)
	deleted: number // unstaged deleted
	untracked: number
	stash: number
	ahead: number
	behind: number
}

export type GitPr = { number: number; url: string }

function emptyGitStatus(stashOut: string): GitStatus {
	const trimmedStash = stashOut.trim()
	const stashCount = trimmedStash ? trimmedStash.split('\n').length : 0
	return {
		modified: 0,
		staged: 0,
		deleted: 0,
		untracked: 0,
		stash: stashCount,
		ahead: 0,
		behind: 0,
	}
}

type GitCounters = Omit<GitStatus, 'stash'>

type GitRowDelta = Partial<
	Pick<
		GitCounters,
		'ahead' | 'behind' | 'staged' | 'modified' | 'deleted' | 'untracked'
	>
>

function emptyCounters(): GitCounters {
	return {
		modified: 0,
		staged: 0,
		deleted: 0,
		untracked: 0,
		ahead: 0,
		behind: 0,
	}
}

const EMPTY_DELTA: GitRowDelta = {}

/** Porcelain v2 row shapes: ordinary entries start `1 <XY>`, renames `2 <XY>`. */
const ORDINARY_ROW_PREFIXES = ['1 ', '2 '] as const
const XY_CODE_OFFSET = 2 // after the `1 ` / `2 ` prefix
const XY_CODE_SPAN = 2
const STAGED_NOOP_CHARS = ['.', ' '] as const

function branchAbDelta(line: string): GitRowDelta {
	const branchAb = line.match(/\+(\d+)\s+-(\d+)/)
	if (!branchAb) return EMPTY_DELTA
	const [, plusCount, minusCount] = branchAb
	return { ahead: Number(plusCount), behind: Number(minusCount) }
}

function xyDelta(line: string): GitRowDelta {
	const isOrdinaryRow = ORDINARY_ROW_PREFIXES.some(prefix =>
		line.startsWith(prefix),
	)
	if (!isOrdinaryRow) return EMPTY_DELTA
	const [stagedChar, worktreeChar] = line.slice(
		XY_CODE_OFFSET,
		XY_CODE_OFFSET + XY_CODE_SPAN,
	)
	const hasStagedWork =
		stagedChar !== STAGED_NOOP_CHARS[0] &&
		stagedChar !== STAGED_NOOP_CHARS[1]
	return {
		staged: hasStagedWork ? 1 : 0,
		modified: worktreeChar === 'M' ? 1 : 0,
		deleted: worktreeChar === 'D' ? 1 : 0,
	}
}

/** Porcelain v2 row → counter delta (untracked rows, XY codes, branch.ab). */
function rowDelta(line: string): GitRowDelta {
	if (line.startsWith('# branch.ab')) return branchAbDelta(line)
	if (line.startsWith('? ')) return { untracked: 1 }
	return xyDelta(line)
}

function applyDelta(counters: GitCounters, delta: GitRowDelta): GitCounters {
	return {
		modified: counters.modified + (delta.modified ?? 0),
		staged: counters.staged + (delta.staged ?? 0),
		deleted: counters.deleted + (delta.deleted ?? 0),
		untracked: counters.untracked + (delta.untracked ?? 0),
		ahead: counters.ahead + (delta.ahead ?? 0),
		behind: counters.behind + (delta.behind ?? 0),
	}
}

/** Parse `git status --porcelain=v2 --branch` + stash list. Null outside a repo. */
export async function fetchGitStatus(cwd: string): Promise<GitStatus | null> {
	try {
		const [{ stdout }, { stdout: stashOut }] = await Promise.all([
			execFileAsync('git', ['status', '--porcelain=v2', '--branch'], {
				cwd,
				timeout: GIT_TIMEOUT_MS,
			}),
			execFileAsync('git', ['stash', 'list'], {
				cwd,
				timeout: GIT_TIMEOUT_MS,
			}),
		])
		const counters = stdout
			.split('\n')
			.reduce(
				(accumulated, line) => applyDelta(accumulated, rowDelta(line)),
				emptyCounters(),
			)
		return { ...emptyGitStatus(stashOut), ...counters }
	} catch {
		return null
	}
}

function isGitPr(candidate: unknown): candidate is GitPr {
	if (!isRecord(candidate)) return false
	const prNumber = candidate.number
	const prUrl = candidate.url
	return (
		typeof prNumber === 'number' &&
		Number.isInteger(prNumber) &&
		prNumber > 0 &&
		typeof prUrl === 'string' &&
		prUrl.startsWith('https://')
	)
}

/** Resolve the PR attached to the current branch via `gh`. Null if none / not GitHub. */
export async function fetchCurrentPr(cwd: string): Promise<GitPr | null> {
	try {
		const { stdout } = await execFileAsync(
			'gh',
			['pr', 'view', '--json', 'number,url'],
			{
				cwd,
				timeout: PR_TIMEOUT_MS,
			},
		)
		const parsed: unknown = JSON.parse(stdout)
		if (!isGitPr(parsed)) return null
		return parsed
	} catch {
		return null
	}
}
