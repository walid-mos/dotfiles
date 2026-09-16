// wt CLI boundary. This extension never creates, names or removes containers:
// the wt workspace registry owns that identity, and wt owns creation, repair
// and teardown. Everything here is read-only except `wt sync`, which asks wt to
// start a stopped container or rebuild an absent one from its recorded
// snapshot. Nothing parses the registry file directly.
import { execFile } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const COMMAND_TIMEOUT_MS = 900000
const MAX_OUTPUT_BYTES = 8388608

export type ContainerState = 'absent' | 'running' | 'stopped' | 'unknown'

export interface SandboxWorkspace {
	/** Canonical checkout path, exactly as the registry records it. */
	path: string
	branch: string
	containerName: string
	containerState: ContainerState
	/** Host ports published by `container run`, empty when none are configured. */
	ports: string[]
	/** Memory limit recorded at spawn (e.g. "2G"); empty when the row predates the setting. */
	memory: string
}

export type WorkspaceLookup =
	| { kind: 'containerized'; workspace: SandboxWorkspace }
	/** Registered, but the row is not containerized: nothing to route into. */
	| { kind: 'plain' }
	/** Not a wt workspace at all (or wt is unavailable). */
	| { kind: 'missing' }

export interface WorkspaceProbe {
	lookup: WorkspaceLookup
	/** Why routing is off; empty when a containerized workspace was found. */
	reason: string
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

function stringField(source: object, key: string): string | null {
	const fieldValue: unknown = Reflect.get(source, key)
	if (typeof fieldValue !== 'string') return null
	return fieldValue
}

function containerState(reportedState: unknown): ContainerState {
	if (
		reportedState === 'running' ||
		reportedState === 'stopped' ||
		reportedState === 'absent' ||
		reportedState === 'unknown'
	) {
		return reportedState
	}
	return 'unknown'
}

function readPorts(row: object): string[] {
	const config: unknown = Reflect.get(row, 'container_config')
	if (typeof config !== 'object' || config === null) return []
	const ports: unknown = Reflect.get(config, 'ports')
	if (!Array.isArray(ports)) return []
	return ports.filter((port): port is string => typeof port === 'string')
}

/** The recorded memory limit, shown so a starved VM is never a mystery. */
function readMemory(row: object): string {
	const config: unknown = Reflect.get(row, 'container_config')
	if (typeof config !== 'object' || config === null) return ''
	return stringField(config, 'memory') ?? ''
}

/** Is `candidate` the workspace root or inside it? Both are canonical absolute paths. */
export function isInsideWorkspace(root: string, candidate: string): boolean {
	return candidate === root || candidate.startsWith(`${root}/`)
}

/** Deepest registered workspace containing `cwd`, containerized or not. */
export function locateWorkspace(rows: unknown, cwd: string): WorkspaceLookup {
	if (!Array.isArray(rows)) return { kind: 'missing' }
	let bestPath: string | null = null
	let bestRow: object | null = null
	for (const row of rows) {
		if (typeof row !== 'object' || row === null) continue
		const path = stringField(row, 'path')
		if (!path || !isInsideWorkspace(path, cwd)) continue
		if (bestPath === null || path.length > bestPath.length) {
			bestPath = path
			bestRow = row
		}
	}
	if (bestRow === null || bestPath === null) return { kind: 'missing' }
	if (Reflect.get(bestRow, 'containerized') !== true) return { kind: 'plain' }
	const branch = stringField(bestRow, 'branch')
	const containerName = stringField(bestRow, 'container_name')
	if (!branch || !containerName) return { kind: 'plain' }
	return {
		kind: 'containerized',
		workspace: {
			path: bestPath,
			branch,
			containerName,
			containerState: containerState(Reflect.get(bestRow, 'container')),
			ports: readPorts(bestRow),
			memory: readMemory(bestRow),
		},
	}
}

/** Best-effort canonical spelling: wt records canonical paths, cwd may not be. */
function canonicalCwd(cwd: string): string {
	try {
		return realpathSync(cwd)
	} catch {
		return cwd
	}
}

async function wtJson(args: string[], cwd: string): Promise<unknown> {
	const { stdout } = await execFileAsync('wt', args, {
		cwd,
		timeout: COMMAND_TIMEOUT_MS,
		maxBuffer: MAX_OUTPUT_BYTES,
	})
	return JSON.parse(stdout)
}

/** What `wt sync` reported, mapped to a human reason; null when the container runs. */
function syncOutcome(payload: unknown): string | null {
	if (typeof payload !== 'object' || payload === null)
		return 'wt sync returned an unexpected reply'
	const report: unknown = Reflect.get(payload, 'sync')
	if (typeof report !== 'object' || report === null)
		return 'wt sync returned no sync report'
	const state = stringField(report, 'container')
	if (state === 'running') return null
	return `wt sync left the container ${state ?? 'in an unknown state'}`
}

/** The `error.message` of a wt JSON envelope, an output tail for plain text. */
function envelopeMessage(output: string): string | null {
	let payload: unknown
	try {
		payload = JSON.parse(output)
	} catch {
		return output.trim().split('\n').at(-1) || null
	}
	if (typeof payload !== 'object' || payload === null) return null
	const envelope: unknown = Reflect.get(payload, 'error')
	if (typeof envelope !== 'object' || envelope === null) return null
	return stringField(envelope, 'message')
}

/** Error text from a wt JSON envelope, with the raw output as the fallback. */
function failureReason(error: unknown): string {
	if (typeof error !== 'object' || error === null) return describe(error)
	for (const output of [
		stringField(error, 'stdout'),
		stringField(error, 'stderr'),
	]) {
		if (!output) continue
		const message = envelopeMessage(output)
		if (message) return message
	}
	return describe(error)
}

/** Which workspace backs this directory, and why not when none does. */
export async function probeWorkspace(cwd: string): Promise<WorkspaceProbe> {
	const canonical = canonicalCwd(cwd)
	let payload: unknown
	try {
		payload = await wtJson(['list', '--json'], canonical)
	} catch (error) {
		return {
			lookup: { kind: 'missing' },
			reason: `wt list --json failed: ${failureReason(error)}`,
		}
	}
	const rows: unknown =
		typeof payload === 'object' && payload !== null
			? Reflect.get(payload, 'workspaces')
			: null
	const lookup = locateWorkspace(rows, canonical)
	switch (lookup.kind) {
		case 'containerized':
			return { lookup, reason: '' }
		case 'plain':
			return {
				lookup,
				reason: `${canonical} is a wt workspace without a container; clean and respawn it, or enable containerization in wt's config`,
			}
		default:
			return { lookup, reason: '' }
	}
}

/** Start or rebuild the row's container. Returns null on success. */
export async function ensureContainerRunning(
	workspace: SandboxWorkspace,
): Promise<string | null> {
	if (workspace.containerState === 'running') return null
	try {
		return syncOutcome(
			await wtJson(['sync', workspace.path, '--json'], workspace.path),
		)
	} catch (error) {
		return `wt sync failed: ${failureReason(error)}`
	}
}
