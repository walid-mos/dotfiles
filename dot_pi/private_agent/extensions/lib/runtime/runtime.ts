/**
 * One file and process API for a path: the Boat when the path lies under a
 * workspace anchor (or the Boat's home), the local machine otherwise. The pwd
 * is the mount point; no other routing rule exists.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import {
	access,
	mkdir,
	readFile,
	readdir,
	stat,
	writeFile,
} from 'node:fs/promises'

import { anchorFor, knownTargetFor } from './anchor.ts'
import { RemoteRuntime } from './remote-runtime.ts'

import type { ExecOptions } from './remote.ts'

export interface RuntimeStat {
	readonly isDirectory: boolean
	readonly isFile: boolean
	readonly size: number
	readonly mtimeMs: number
}

export interface DirectoryEntry {
	readonly name: string
	readonly isDirectory: boolean
	readonly isFile: boolean
	readonly isSymbolicLink: boolean
}

export interface CommandOutput {
	readonly stdout: string
	readonly stderr: string
	readonly exitCode: number | null
}

export interface Runtime {
	readonly isRemote: boolean
	/** Path as the executing machine sees it. */
	toTarget(path: string): string
	readFile(path: string): Promise<Buffer>
	readFileSync(path: string): Buffer
	writeFile(path: string, content: string | Buffer): Promise<void>
	mkdir(path: string): Promise<void>
	access(path: string): Promise<void>
	exists(path: string): Promise<boolean>
	existsSync(path: string): boolean
	stat(path: string): Promise<RuntimeStat>
	statSync(path: string): RuntimeStat
	readdir(path: string): Promise<string[]>
	readdirSync(path: string): string[]
	listDirectory(path: string): Promise<DirectoryEntry[]>
	/** Run a shell command in `cwd`, capturing its output. */
	run(command: string, cwd: string): Promise<CommandOutput>
	/** Run a shell command in `cwd`, streaming its output. */
	exec(
		command: string,
		cwd: string,
		options: ExecOptions,
	): Promise<{ exitCode: number | null }>
}

export function runtimeFor(path: string): Runtime {
	const anchor = knownTargetFor(path)?.anchor ?? anchorFor(path)
	if (!anchor) return LOCAL
	return new RemoteRuntime(anchor)
}

type NodeStats = {
	isDirectory: () => boolean
	isFile: () => boolean
	size: number
	mtimeMs: number
}

function fromStats(stats: NodeStats): RuntimeStat {
	return {
		isDirectory: stats.isDirectory(),
		isFile: stats.isFile(),
		size: stats.size,
		mtimeMs: stats.mtimeMs,
	}
}

async function isAccessible(path: string): Promise<boolean> {
	try {
		await access(path)
		return true
	} catch {
		return false
	}
}

const LOCAL: Runtime = {
	isRemote: false,
	toTarget: path => path,
	readFile: path => readFile(path),
	readFileSync: path => readFileSync(path),
	writeFile: (path, content) => writeFile(path, content),
	mkdir: async path => {
		await mkdir(path, { recursive: true })
	},
	access: path => access(path),
	exists: isAccessible,
	existsSync: path => existsSync(path),
	stat: async path => fromStats(await stat(path)),
	statSync: path => fromStats(statSync(path)),
	readdir: path => readdir(path),
	readdirSync: path => readdirSync(path),
	listDirectory: async path =>
		(await readdir(path, { withFileTypes: true })).map(entry => ({
			name: entry.name,
			isDirectory: entry.isDirectory(),
			isFile: entry.isFile(),
			isSymbolicLink: entry.isSymbolicLink(),
		})),
	run: (command, cwd) => runLocal(command, cwd),
	exec: (command, cwd, options) => execLocal(command, cwd, options),
}

function runLocal(command: string, cwd: string): Promise<CommandOutput> {
	return new Promise((resolve, reject) => {
		const child = spawn('bash', ['-c', command], { cwd })
		const stdout: Buffer[] = []
		const stderr: Buffer[] = []
		child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
		child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
		child.on('error', reject)
		child.on('close', exitCode =>
			resolve({
				stdout: Buffer.concat(stdout).toString('utf8'),
				stderr: Buffer.concat(stderr).toString('utf8'),
				exitCode,
			}),
		)
	})
}

function execLocal(
	command: string,
	cwd: string,
	options: ExecOptions,
): Promise<{ exitCode: number | null }> {
	return new Promise((resolve, reject) => {
		const child = spawn('bash', ['-c', command], {
			cwd,
			signal: options.signal,
		})
		child.stdout.on('data', options.onData)
		child.stderr.on('data', options.onData)
		child.on('error', reject)
		child.on('close', exitCode => resolve({ exitCode }))
	})
}
