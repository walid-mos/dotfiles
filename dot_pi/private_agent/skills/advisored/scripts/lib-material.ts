import { gitHead, gitStatusEntries, gitTopLevel } from './lib-fingerprint.ts'
import { runProcess } from './lib-process.ts'

import type { StatusEntry } from './lib-fingerprint.ts'

const UNTRACKED_CODE = '??'
const FILE_DIFF_LIMIT_BYTES = 65_536
const GIT_TIMEOUT_MS = 60_000
const DIFF_EXIT_CODES = new Set([0, 1])
const EMPTY_SIDE = '/dev/null'
const SECRET_PATH =
	/(^|\/)(\.env(\..*)?|[^/]*\.(pem|key|p12|pfx)|[^/]*(secret|credential)[^/]*)$/i

function gitDiff(repo: string, diffArguments: readonly string[]): string {
	const outcome = runProcess({
		command: 'git',
		arguments: ['diff', ...diffArguments],
		cwd: repo,
		timeoutMs: GIT_TIMEOUT_MS,
	})
	if (outcome.exitCode === null || !DIFF_EXIT_CODES.has(outcome.exitCode))
		return `git diff failed for ${diffArguments.at(-1)}: ${outcome.stderr.trim()}\n`
	return outcome.stdout
}

function fileDiff(repo: string, entry: StatusEntry): string {
	if (SECRET_PATH.test(entry.path))
		return `diff for ${entry.path} omitted: the path looks like a secret store. The fingerprint covers the file.\n`
	const diff =
		entry.code === UNTRACKED_CODE
			? gitDiff(repo, ['--no-index', '--', EMPTY_SIDE, entry.path])
			: gitDiff(repo, ['HEAD', '--', entry.path])
	const bytes = Buffer.byteLength(diff)
	if (bytes <= FILE_DIFF_LIMIT_BYTES) return diff
	return `diff for ${entry.path} omitted: ${bytes} bytes exceed the ${FILE_DIFF_LIMIT_BYTES} byte limit. The fingerprint covers the file; ask for excerpts.\n`
}

export function recordMaterial(repo: string): string {
	const topLevel = gitTopLevel(repo)
	if (!topLevel)
		return `${repo} is not a git work tree: no diff recorded, the implementer section must carry the material.`
	const entries = gitStatusEntries(repo)
	const heading = `repo ${topLevel} at ${gitHead(repo)}`
	if (!entries.length) return `${heading}: no uncommitted change.`
	const diffs = entries.map(entry => fileDiff(topLevel, entry))
	return [`${heading}, ${entries.length} changed path(s)`, ...diffs].join(
		'\n',
	)
}
