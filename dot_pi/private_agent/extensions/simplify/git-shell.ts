/**
 * Running git: the only process boundary in /simplify. Every other module in
 * this folder is either pure or works on the text this one produced.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { errorMessage, isRecord } from './json.ts'

const execFileAsync = promisify(execFile)

const GIT_TIMEOUT_MS = 20_000
const MAX_OUTPUT_BYTES = 33_554_432

/** A scope that cannot be collected: the message is shown to the user as-is. */
export class ScopeError extends Error {}

export async function git(
	cwd: string,
	args: readonly string[],
): Promise<string> {
	try {
		const { stdout } = await execFileAsync('git', args, {
			cwd,
			timeout: GIT_TIMEOUT_MS,
			maxBuffer: MAX_OUTPUT_BYTES,
		})
		return stdout
	} catch (error) {
		throw new ScopeError(gitFailure(args, error))
	}
}

/** A probe that is allowed to fail: undefined means "git said no". */
export async function tryGit(
	cwd: string,
	args: readonly string[],
): Promise<string | undefined> {
	try {
		return await git(cwd, args)
	} catch {
		return undefined
	}
}

function gitFailure(args: readonly string[], error: unknown): string {
	const stderr = isRecord(error) ? firstLine(error.stderr) : undefined
	const detail = stderr ?? firstLine(errorMessage(error))
	return `git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`
}

function firstLine(detail: unknown): string | undefined {
	if (typeof detail !== 'string') return undefined
	const [line] = detail.trim().split('\n')
	if (!line) return undefined
	return line
}
