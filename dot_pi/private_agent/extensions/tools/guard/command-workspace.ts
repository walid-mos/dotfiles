/** Best-effort repeat-warning key, never proof that external validation inputs are unchanged. */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

import { runtimeFor } from '#lib/runtime/runtime.ts'

import type { Runtime } from '#lib/runtime/runtime.ts'

const exec = promisify(execFile)
const MAX_GIT_BYTES = 4_194_304
const MAX_UNTRACKED_FILES = 1000
const GIT_TIMEOUT_MS = 1500

// One ssh round trip on a Boat: the same inputs hashed there (GNU stat).
const REMOTE_SIGNATURE = `[ "$(git ls-files --others --exclude-standard | wc -l)" -le ${MAX_UNTRACKED_FILES} ] || exit 3
{ git rev-parse HEAD; git diff --no-ext-diff --no-textconv --binary HEAD --; git ls-files --others --exclude-standard -z | xargs -0 -r stat -c '%n %s %Y %Z' --; } | sha256sum`

async function remoteWorkspace(runtime: Runtime, cwd: string): Promise<string> {
	try {
		const signature = await runtime.run(
			`GIT_OPTIONAL_LOCKS=0; export GIT_OPTIONAL_LOCKS\n${REMOTE_SIGNATURE}`,
			cwd,
		)
		if (signature.exitCode !== 0) return ''
		return createHash('sha256')
			.update(JSON.stringify([cwd, signature.stdout, process.env]))
			.digest('hex')
	} catch {
		return ''
	}
}

export async function commandWorkspace(cwd: string): Promise<string> {
	const runtime = runtimeFor(cwd)
	if (runtime.isRemote) return remoteWorkspace(runtime, cwd)
	try {
		const git = (
			args: string[],
		): Promise<{ stdout: string; stderr: string }> =>
			exec('git', args, {
				cwd,
				timeout: GIT_TIMEOUT_MS,
				maxBuffer: MAX_GIT_BYTES,
				env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
			})
		const [head, diff, untracked] = await Promise.all([
			git(['rev-parse', 'HEAD']),
			git([
				'diff',
				'--no-ext-diff',
				'--no-textconv',
				'--binary',
				'HEAD',
				'--',
			]),
			git(['ls-files', '--others', '--exclude-standard', '-z']),
		])
		const files = untracked.stdout.split('\0').filter(Boolean)
		if (files.length > MAX_UNTRACKED_FILES) return ''
		const signatures = await Promise.all(
			files.map(async path => {
				const file = await stat(resolve(cwd, path))
				return [path, file.size, file.mtimeMs, file.ctimeMs]
			}),
		)
		return createHash('sha256')
			.update(
				JSON.stringify([
					cwd,
					head.stdout,
					diff.stdout,
					signatures,
					process.env,
				]),
			)
			.digest('hex')
	} catch {
		// Missing Git, untracked churn or a bounded scan failure disables warnings, not execution.
		return ''
	}
}
