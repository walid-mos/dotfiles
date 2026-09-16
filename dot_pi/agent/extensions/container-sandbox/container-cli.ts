// The `container` CLI as a process boundary: spawn it, stream or collect its output, and
// make sure a killed client does not leave the client process itself behind. Nothing here
// knows about guest sessions or wt; container.ts builds the argv that uses this.
import { spawn } from 'node:child_process'

export const CONTAINER_BIN = 'container'
export const MS_PER_SECOND = 1000

export interface RunResult {
	exitCode: number
	stdout: string
	stderr: string
}

export interface CliStreamOptions {
	onData?: (chunk: Buffer) => void
	signal?: AbortSignal
	timeoutSeconds?: number
}

/**
 * Run the CLI and collect its output. A timeout kills the client and their process group,
 * so a hanging runtime call cannot hold a turn: exitCode -1 marks the timeout.
 */
export async function runCapture(
	args: string[],
	timeoutSeconds = 0,
): Promise<RunResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(CONTAINER_BIN, args, {
			stdio: ['ignore', 'pipe', 'pipe'],
			detached: true,
		})
		const stdoutChunks: Buffer[] = []
		const stderrChunks: Buffer[] = []
		let didTimeOut = false
		let timeoutHandle: NodeJS.Timeout | undefined
		if (timeoutSeconds > 0) {
			timeoutHandle = setTimeout(() => {
				didTimeOut = true
				killProcessTree(child)
			}, timeoutSeconds * MS_PER_SECOND)
		}
		child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
		child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))
		child.on('error', error => {
			if (timeoutHandle) clearTimeout(timeoutHandle)
			reject(error)
		})
		child.on('close', code => {
			if (timeoutHandle) clearTimeout(timeoutHandle)
			resolve({
				exitCode: didTimeOut ? -1 : (code ?? -1),
				stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
				stderr: Buffer.concat(stderrChunks).toString('utf-8'),
			})
		})
	})
}

/** Run the CLI and stream both output channels to the caller as they arrive. */
export function runStreaming(
	args: string[],
	options: CliStreamOptions,
): Promise<RunResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(CONTAINER_BIN, args, {
			stdio: ['ignore', 'pipe', 'pipe'],
			detached: true,
		})

		let didTimeOut = false
		let timeoutHandle: NodeJS.Timeout | undefined
		const timeoutMs = (options.timeoutSeconds ?? 0) * MS_PER_SECOND
		if (timeoutMs > 0) {
			timeoutHandle = setTimeout(() => {
				didTimeOut = true
				killProcessTree(child)
			}, timeoutMs)
		}

		child.stdout.on('data', (chunk: Buffer) => options.onData?.(chunk))
		child.stderr.on('data', (chunk: Buffer) => options.onData?.(chunk))

		child.on('error', error => {
			if (timeoutHandle) clearTimeout(timeoutHandle)
			reject(error)
		})

		const onAbort = (): void => killProcessTree(child)
		options.signal?.addEventListener('abort', onAbort, { once: true })

		child.on('close', (code): void => {
			if (timeoutHandle) clearTimeout(timeoutHandle)
			options.signal?.removeEventListener('abort', onAbort)
			if (options.signal?.aborted) {
				reject(new Error('aborted'))
			} else if (didTimeOut) {
				reject(new Error(`timeout:${options.timeoutSeconds}`))
			} else {
				resolve({ exitCode: code ?? -1, stdout: '', stderr: '' })
			}
		})
	})
}

function killProcessTree(child: ReturnType<typeof spawn>): void {
	if (!child.pid) {
		child.kill('SIGKILL')
		return
	}
	try {
		process.kill(-child.pid, 'SIGKILL')
	} catch {
		child.kill('SIGKILL')
	}
}
