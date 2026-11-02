import { spawnSync } from 'node:child_process'

export type ProcessRequest = {
	command: string
	arguments: readonly string[]
	cwd: string
	stdin?: string
	timeoutMs: number
}

export type ProcessOutcome = {
	exitCode: number | null
	signal: NodeJS.Signals | null
	stdout: string
	stderr: string
	isTimedOut: boolean
}

const OUTPUT_LIMIT_BYTES = 67_108_864

function isTimeoutError(error: Error | undefined): boolean {
	return (
		error instanceof Error && 'code' in error && error.code === 'ETIMEDOUT'
	)
}

export function runProcess(request: ProcessRequest): ProcessOutcome {
	const outcome = spawnSync(request.command, [...request.arguments], {
		cwd: request.cwd,
		input: request.stdin,
		encoding: 'utf8',
		timeout: request.timeoutMs,
		maxBuffer: OUTPUT_LIMIT_BYTES,
		env: process.env,
	})
	return {
		exitCode: outcome.status,
		signal: outcome.signal,
		stdout: outcome.stdout ?? '',
		stderr: outcome.stderr ?? '',
		isTimedOut: isTimeoutError(outcome.error),
	}
}

export function describeFailure(outcome: ProcessOutcome): string {
	if (outcome.isTimedOut) return 'timed out'
	if (outcome.signal) return `killed by ${outcome.signal}`
	return `exit ${outcome.exitCode ?? 'unknown'}`
}
