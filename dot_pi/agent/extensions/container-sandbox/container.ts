import { spawn, spawnSync } from 'node:child_process'

const CONTAINER_BIN = 'container'
const MS_PER_SECOND = 1000
const NOT_RUNNING_HINT =
	'Apple container runtime is not responding. Run `container system start` and reload this session.'

export interface RunResult {
	exitCode: number
	stdout: string
	stderr: string
}

export interface ExecStreamOptions {
	onData?: (chunk: Buffer) => void
	signal?: AbortSignal
	timeoutSeconds?: number
}

export async function isContainerAvailable(): Promise<boolean> {
	try {
		const lsRun = await runCapture(['ls'])
		return lsRun.exitCode === 0
	} catch {
		return false
	}
}

export function containerUnavailableReason(err: unknown): string {
	const message = err instanceof Error ? err.message : String(err)
	if (
		message.includes('ECONNREFUSED') ||
		message.toLowerCase().includes('connection')
	) {
		return NOT_RUNNING_HINT
	}
	return message
}

export async function containerExists(name: string): Promise<boolean> {
	const inspectRun = await runCapture(['inspect', name])
	return inspectRun.exitCode === 0
}

export async function isContainerRunning(name: string): Promise<boolean> {
	const execProbe = await runCapture(['exec', name, '/bin/true'])
	return execProbe.exitCode === 0
}

export async function startExistingContainer(name: string): Promise<RunResult> {
	return runCapture(['start', name])
}

export async function createContainer(
	name: string,
	options: ContainerRunOptions,
): Promise<RunResult> {
	return runCapture(buildRunArgs(name, options))
}

export interface ContainerRunOptions {
	image: string
	mountSource: string | null
	workdir: string
	cpus: number
	memory: string
	env: Record<string, string>
	runArgs: string[]
	initArgs: string[]
}

function buildRunArgs(name: string, o: ContainerRunOptions): string[] {
	const args = [
		'run',
		'--detach',
		'--name',
		name,
		'--cpus',
		String(o.cpus),
		'--memory',
		o.memory,
		'-w',
		o.workdir,
	]
	if (o.mountSource) args.push('-v', `${o.mountSource}:${o.workdir}`)
	for (const [key, value] of Object.entries(o.env)) {
		args.push('-e', `${key}=${value}`)
	}
	args.push(...o.runArgs, o.image, ...o.initArgs)
	return args
}

export async function execInContainer(
	name: string,
	workdir: string,
	command: string,
	options: ExecStreamOptions = {},
): Promise<RunResult> {
	const args = ['exec', '-w', workdir, name, 'bash', '-lc', command]
	return runStreaming(args, options)
}

export async function stopContainer(name: string): Promise<RunResult> {
	return runCapture(['stop', name])
}

export function bestEffortContainerIp(name: string): string | null {
	const lsListing = spawnSync(CONTAINER_BIN, ['ls'], { encoding: 'utf-8' })
	if (lsListing.status !== 0 || typeof lsListing.stdout !== 'string')
		return null
	const ownLine = lsListing.stdout
		.split('\n')
		.find(line => line.includes(name))
	const ipMatch = ownLine?.match(/(\d{1,3}(?:\.\d{1,3}){3})/)
	return ipMatch?.[1] ?? null
}

async function runCapture(args: string[]): Promise<RunResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(CONTAINER_BIN, args, {
			stdio: ['ignore', 'pipe', 'pipe'],
		})
		const stdoutChunks: Buffer[] = []
		const stderrChunks: Buffer[] = []
		child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
		child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))
		child.on('error', reject)
		child.on('close', code =>
			resolve({
				exitCode: code ?? -1,
				stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
				stderr: Buffer.concat(stderrChunks).toString('utf-8'),
			}),
		)
	})
}

function runStreaming(
	args: string[],
	options: ExecStreamOptions,
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

		child.on('error', err => {
			if (timeoutHandle) clearTimeout(timeoutHandle)
			reject(err)
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
