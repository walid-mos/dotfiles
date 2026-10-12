/** The Runtime of a workspace anchor: every path and command runs on its Boat. */
import { isWithin, targetFor, targetSync } from './anchor.ts'
import { capture, captureSync, exec, quote } from './remote.ts'

import type { Anchor, WorkspaceTarget } from './anchor.ts'
import type { CaptureResult, ExecOptions } from './remote.ts'
import type {
	CommandOutput,
	DirectoryEntry,
	Runtime,
	RuntimeStat,
} from './runtime.ts'

const MS_PER_SECOND = 1000
const ERROR_CODES: readonly [RegExp, string][] = [
	[/No such file|cannot stat/i, 'ENOENT'],
	[/Permission denied/i, 'EACCES'],
	[/Is a directory/i, 'EISDIR'],
	[/Not a directory/i, 'ENOTDIR'],
]

type PathScript = (quotedPath: string) => string

const readScript: PathScript = quoted => `cat -- ${quoted}`
const writeScript: PathScript = quoted => `cat > ${quoted}`
const mkdirScript: PathScript = quoted => `mkdir -p -- ${quoted}`
const existsScript: PathScript = quoted => `test -e ${quoted}`
const accessScript: PathScript = quoted =>
	`test -r ${quoted} || { echo 'No such file or directory' >&2; exit 1; }`
const statScript: PathScript = quoted => `stat -L -c '%F|%s|%Y' -- ${quoted}`
const listScript: PathScript = quoted =>
	`test -d ${quoted} || { echo 'Not a directory' >&2; exit 1; }; find ${quoted} -mindepth 1 -maxdepth 1 -printf '%f\\0'`

const typedListScript: PathScript = quoted =>
	`test -d ${quoted} || { echo 'Not a directory' >&2; exit 1; }; find ${quoted} -mindepth 1 -maxdepth 1 -printf '%f%y\\0'`

export class RemoteRuntime implements Runtime {
	readonly isRemote = true
	private readonly anchor: Anchor

	constructor(anchor: Anchor) {
		this.anchor = anchor
	}

	toTarget(path: string): string {
		return mapPath(targetSync(this.anchor), path)
	}

	async readFile(path: string): Promise<Buffer> {
		return stdoutOf(path, await this.onPath(path, readScript))
	}

	readFileSync(path: string): Buffer {
		return stdoutOf(path, this.onPathSync(path, readScript))
	}

	async writeFile(path: string, content: string | Buffer): Promise<void> {
		stdoutOf(path, await this.onPath(path, writeScript, content))
	}

	async mkdir(path: string): Promise<void> {
		stdoutOf(path, await this.onPath(path, mkdirScript))
	}

	async access(path: string): Promise<void> {
		stdoutOf(path, await this.onPath(path, accessScript))
	}

	async exists(path: string): Promise<boolean> {
		const probe = await this.onPath(path, existsScript)
		return probe.exitCode === 0
	}

	existsSync(path: string): boolean {
		return this.onPathSync(path, existsScript).exitCode === 0
	}

	async stat(path: string): Promise<RuntimeStat> {
		return parseStat(stdoutOf(path, await this.onPath(path, statScript)))
	}

	statSync(path: string): RuntimeStat {
		return parseStat(stdoutOf(path, this.onPathSync(path, statScript)))
	}

	async readdir(path: string): Promise<string[]> {
		return parseList(stdoutOf(path, await this.onPath(path, listScript)))
	}

	readdirSync(path: string): string[] {
		return parseList(stdoutOf(path, this.onPathSync(path, listScript)))
	}

	async listDirectory(path: string): Promise<DirectoryEntry[]> {
		const listing = stdoutOf(path, await this.onPath(path, typedListScript))
		return parseList(listing).map(entry => ({
			name: entry.slice(0, -1),
			isDirectory: entry.endsWith('d'),
			isFile: entry.endsWith('f'),
			isSymbolicLink: entry.endsWith('l'),
		}))
	}

	async run(command: string, cwd: string): Promise<CommandOutput> {
		const target = await targetFor(this.anchor)
		const commandResult = await capture(
			target.host,
			`cd ${quote(mapPath(target, cwd))} && ${command}`,
		)
		return {
			stdout: commandResult.stdout.toString('utf8'),
			stderr: commandResult.stderr,
			exitCode: commandResult.exitCode,
		}
	}

	async exec(
		command: string,
		cwd: string,
		options: ExecOptions,
	): Promise<{ exitCode: number | null }> {
		const target = await targetFor(this.anchor)
		return exec(target.host, mapPath(target, cwd), command, options)
	}

	private async onPath(
		path: string,
		script: PathScript,
		input?: string | Buffer,
	): Promise<CaptureResult> {
		const target = await targetFor(this.anchor)
		return capture(target.host, script(quote(mapPath(target, path))), input)
	}

	private onPathSync(path: string, script: PathScript): CaptureResult {
		const target = targetSync(this.anchor)
		return captureSync(target.host, script(quote(mapPath(target, path))))
	}
}

function mapPath(target: WorkspaceTarget, path: string): string {
	if (!isWithin(path, target.anchor.root)) return path
	return `${target.remoteRoot}${path.slice(target.anchor.root.length)}`
}

function parseStat(raw: Buffer): RuntimeStat {
	const [kind = '', size = '0', seconds = '0'] = raw
		.toString('utf8')
		.trim()
		.split('|')
	return {
		isDirectory: kind === 'directory',
		isFile: kind.startsWith('regular'),
		size: Number(size),
		mtimeMs: Number(seconds) * MS_PER_SECOND,
	}
}

function parseList(raw: Buffer): string[] {
	return raw.toString('utf8').split('\0').filter(Boolean)
}

/** stdout of a successful remote command, else an error carrying an fs-like code. */
function stdoutOf(path: string, commandResult: CaptureResult): Buffer {
	if (commandResult.exitCode === 0) return commandResult.stdout
	const stderr = commandResult.stderr.trim()
	const code =
		ERROR_CODES.find(([pattern]) => pattern.test(stderr))?.[1] ?? 'EIO'
	throw Object.assign(
		new Error(`${code}: ${stderr || 'remote command failed'}, '${path}'`),
		{ code, path },
	)
}
