/** Find the workspace anchor owning a local path and resolve its Boat through the workspace CLI. */
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const ANCHOR_MARKER = '.workspace.json'
const WORKSPACE_BIN = 'workspace'
const STATUS_TIMEOUT_MS = 120_000
const RESUME_TIMEOUT_MS = 600_000
const MAX_BUFFER_BYTES = 4_194_304
const TARGETS = Symbol.for('pi.workspace.targets.v1')

export interface Anchor {
	readonly root: string
	readonly repo: string
	readonly branch: string
}

export interface WorkspacePort {
	readonly name: string
	readonly port: number
	readonly url: string
}

export interface WorkspaceTarget {
	readonly anchor: Anchor
	readonly host: string
	readonly remoteRoot: string
	readonly remoteHome: string
	readonly isLive: boolean
	readonly ports: readonly WorkspacePort[]
}

const previous: unknown = Reflect.get(globalThis, TARGETS)
const targets: Map<string, WorkspaceTarget> =
	previous instanceof Map ? previous : new Map()
Reflect.set(globalThis, TARGETS, targets)

/** The anchor whose directory contains `path`, walking up to `/`. */
export function anchorFor(path: string): Anchor | undefined {
	const marker = join(path, ANCHOR_MARKER)
	if (existsSync(marker)) return readAnchor(path, marker)
	const parent = dirname(path)
	if (parent === path) return undefined
	return anchorFor(parent)
}

/** A resolved target whose anchor or Boat home contains `path`. */
export function knownTargetFor(path: string): WorkspaceTarget | undefined {
	return [...targets.values()].find(
		target =>
			isWithin(path, target.anchor.root) ||
			isWithin(path, target.remoteHome),
	)
}

export function isWithin(path: string, root: string): boolean {
	return path === root || path.startsWith(`${root}/`)
}

/** Current state of the anchor's workspace; refreshes the shared cache. */
export async function refreshTarget(anchor: Anchor): Promise<WorkspaceTarget> {
	const output = await runWorkspace(
		['status', anchor.repo, anchor.branch, '--json'],
		STATUS_TIMEOUT_MS,
	)
	return remember(anchor, output)
}

/** Resume the Boat (tailnet, dev server, ports), then cache its state. */
export async function resumeTarget(anchor: Anchor): Promise<WorkspaceTarget> {
	const output = await runWorkspace(
		['resume', anchor.repo, anchor.branch, '--json'],
		RESUME_TIMEOUT_MS,
	)
	return remember(anchor, output)
}

/** Cached target, resolved synchronously through the CLI on first use. */
export function targetSync(anchor: Anchor): WorkspaceTarget {
	const cached = targets.get(anchor.root)
	if (cached) return cached
	const output = execFileSync(
		WORKSPACE_BIN,
		['status', anchor.repo, anchor.branch, '--json'],
		{
			encoding: 'utf8',
			timeout: STATUS_TIMEOUT_MS,
			maxBuffer: MAX_BUFFER_BYTES,
		},
	)
	return remember(anchor, output)
}

export async function targetFor(anchor: Anchor): Promise<WorkspaceTarget> {
	return targets.get(anchor.root) ?? refreshTarget(anchor)
}

function readAnchor(root: string, marker: string): Anchor | undefined {
	const parsed: unknown = JSON.parse(readFileSync(marker, 'utf8'))
	const repo = Reflect.get(Object(parsed), 'repo')
	const branch = Reflect.get(Object(parsed), 'branch')
	if (typeof repo !== 'string' || typeof branch !== 'string') return undefined
	return { root, repo, branch }
}

function runWorkspace(args: string[], timeout: number): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			WORKSPACE_BIN,
			args,
			{ encoding: 'utf8', timeout, maxBuffer: MAX_BUFFER_BYTES },
			(error, stdout, stderr) => {
				if (error)
					reject(
						new Error(
							`workspace ${args[0]} failed: ${stderr.trim() || error.message}`,
						),
					)
				else resolve(stdout)
			},
		)
	})
}

function remember(anchor: Anchor, output: string): WorkspaceTarget {
	const status: unknown = JSON.parse(output)
	const workspace: unknown = Reflect.get(Object(status), 'workspace')
	const sandbox: unknown = Reflect.get(Object(status), 'sandbox')
	const ports: unknown = Reflect.get(Object(status), 'ports')
	const host = Reflect.get(Object(status), 'host')
	const remoteRoot = Reflect.get(Object(status), 'remote')
	const remoteHome = Reflect.get(Object(workspace), 'remote_home')
	if (
		typeof host !== 'string' ||
		typeof remoteRoot !== 'string' ||
		typeof remoteHome !== 'string'
	)
		throw new Error(
			`workspace status for ${anchor.repo}@${anchor.branch} lacks host, remote or remote_home`,
		)
	const target: WorkspaceTarget = {
		anchor,
		host,
		remoteRoot,
		remoteHome,
		isLive: Reflect.get(Object(sandbox), 'is_live') === true,
		ports: Array.isArray(ports) ? ports.filter(isPort) : [],
	}
	targets.set(anchor.root, target)
	return target
}

function isPort(candidate: unknown): candidate is WorkspacePort {
	return (
		typeof Reflect.get(Object(candidate), 'name') === 'string' &&
		typeof Reflect.get(Object(candidate), 'port') === 'number' &&
		typeof Reflect.get(Object(candidate), 'url') === 'string'
	)
}
