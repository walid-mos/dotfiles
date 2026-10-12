/**
 * Run commands on a workspace Boat through its `ws-<hash>` ssh alias, which the
 * workspace CLI keeps current (endpoint, host key, ControlMaster, forwarded agent).
 */
import { execFile, spawn, spawnSync } from 'node:child_process'

const SSH = 'ssh'
const MAX_BUFFER_BYTES = 67_108_864
const STOP_GRACE_MS = 2000
const MS_PER_SECOND = 1000
const GITHUB_TOKEN = Symbol.for('pi.workspace.github-token.v1')

// The token arrives as the first stdin line so it never shows in argv; the
// rest of stdin stays open, and its end (local abort or timeout) kills the
// command's whole process group on the Boat.
const EXEC_WRAPPER = `IFS= read -r GH_TOKEN || true
if [ -n "$GH_TOKEN" ]; then export GH_TOKEN; else unset GH_TOKEN; fi
cd "$1" || exit 1
setsid bash -c "$2" </dev/null &
child=$!
{ cat >/dev/null; kill -TERM -- "-$child" 2>/dev/null; } <&0 >/dev/null 2>&1 &
watcher=$!
wait "$child"
status=$?
kill "$watcher" 2>/dev/null
exit "$status"`

export interface CaptureResult {
	readonly stdout: Buffer
	readonly stderr: string
	readonly exitCode: number | null
}

export interface ExecOptions {
	readonly onData: (data: Buffer) => void
	readonly signal?: AbortSignal
	readonly timeout?: number
}

export function quote(text: string): string {
	return `'${text.replaceAll("'", `'\\''`)}'`
}

export function capture(
	host: string,
	script: string,
	input: Buffer | string = '',
): Promise<CaptureResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(SSH, [host, '--', 'bash', '-lc', quote(script)])
		const stdout: Buffer[] = []
		const stderr: Buffer[] = []
		child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
		child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
		child.on('error', reject)
		child.on('close', exitCode =>
			resolve({
				stdout: Buffer.concat(stdout),
				stderr: Buffer.concat(stderr).toString('utf8'),
				exitCode,
			}),
		)
		child.stdin.end(input)
	})
}

export function captureSync(host: string, script: string): CaptureResult {
	const finished = spawnSync(
		SSH,
		[host, '--', 'bash', '-lc', quote(script)],
		{
			maxBuffer: MAX_BUFFER_BYTES,
		},
	)
	if (finished.error) throw finished.error
	return {
		stdout: finished.stdout,
		stderr: finished.stderr.toString('utf8'),
		exitCode: finished.status,
	}
}

export async function exec(
	host: string,
	cwd: string,
	command: string,
	options: ExecOptions,
): Promise<{ exitCode: number | null }> {
	const token = await githubToken()
	const child = spawn(SSH, [
		host,
		'--',
		'bash',
		'-lc',
		quote(EXEC_WRAPPER),
		'pi-exec',
		quote(cwd),
		quote(command),
	])
	child.stdin.write(`${token}\n`)
	child.stdout.on('data', options.onData)
	child.stderr.on('data', options.onData)
	return settle(child, options)
}

function settle(
	child: ReturnType<typeof spawn>,
	options: ExecOptions,
): Promise<{ exitCode: number | null }> {
	return new Promise((resolve, reject) => {
		let stopReason: 'aborted' | 'timeout' | undefined
		const stop = (reason: 'aborted' | 'timeout'): void => {
			stopReason = reason
			child.stdin?.end()
			setTimeout(() => child.kill(), STOP_GRACE_MS).unref()
		}
		const onAbort = (): void => stop('aborted')
		const timer = options.timeout
			? setTimeout(() => stop('timeout'), options.timeout * MS_PER_SECOND)
			: undefined
		const cleanup = (): void => {
			if (timer) clearTimeout(timer)
			options.signal?.removeEventListener('abort', onAbort)
			child.stdin?.end()
		}
		if (options.signal?.aborted) stop('aborted')
		else options.signal?.addEventListener('abort', onAbort, { once: true })
		child.on('error', error => {
			cleanup()
			reject(error)
		})
		child.on('close', exitCode => {
			cleanup()
			if (stopReason === 'aborted') reject(new Error('aborted'))
			else if (stopReason === 'timeout')
				reject(new Error(`timeout:${options.timeout}`))
			else resolve({ exitCode })
		})
	})
}

/** `gh auth token` from the Mac, kept in memory for the process. */
function githubToken(): Promise<string> {
	const cached: unknown = Reflect.get(globalThis, GITHUB_TOKEN)
	if (cached instanceof Promise) return cached
	const token = new Promise<string>(resolve => {
		execFile(
			'gh',
			['auth', 'token'],
			{ encoding: 'utf8' },
			(error, stdout) => resolve(error ? '' : stdout.trim()),
		)
	})
	Reflect.set(globalThis, GITHUB_TOKEN, token)
	return token
}
