/** Best-effort repeat-warning key, never proof that external validation inputs are unchanged. */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const MAX_GIT_BYTES = 4_194_304
const MAX_UNTRACKED_FILES = 1000
const GIT_TIMEOUT_MS = 1500

export async function commandWorkspace(cwd: string): Promise<string> {
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
