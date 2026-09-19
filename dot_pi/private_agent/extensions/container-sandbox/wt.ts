// wt CLI boundary. This extension never creates, names or removes containers:
// the wt workspace registry owns that identity, and wt owns creation, repair
// and teardown - including the shared dev VM a devvm workspace lives on. Everything
// here is read-only except `wt sync`, which asks wt to reconcile the workspace:
// start or rebuild its container, or re-run the idempotent devvm add. Nothing
// parses the registry file directly.
import { execFile } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const COMMAND_TIMEOUT_MS = 900000
const MAX_OUTPUT_BYTES = 8388608
/** A line of nothing but JSON syntax carries no reason; a failed wt run ends with one. */
const JSON_SYNTAX_ONLY_LINE = /^[\]{}[",:\s]+$/

export type ContainerState = 'absent' | 'running' | 'stopped' | 'unknown'

/** How wt provisioned the workspace: its own VM, or a namespace on the shared dev VM. */
export type Vehicle = 'container' | 'devvm'

export interface SandboxWorkspace {
	/** Canonical checkout path, exactly as the registry records it. */
	path: string
	branch: string
	containerName: string
	/** How wt provisioned this workspace; decides how the exec boundary reaches it. */
	vehicle: Vehicle
	containerState: ContainerState
	/** Host ports published by `container run`, empty when none are configured. */
	ports: string[]
	/** Ports the project publishes on the workspace's own tailnet node, in declaration order. */
	tailnetPorts: number[]
	/** The port of wt's own workspace index, null when the project reserves none. */
	tailnetIndex: number | null
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

/** Ports the project declares for the workspace's tailnet node, in the order it declared them. */
function readTailnetPorts(row: object): number[] {
	const config: unknown = Reflect.get(row, 'container_config')
	if (typeof config !== 'object' || config === null) return []
	const tailscale: unknown = Reflect.get(config, 'tailscale')
	if (typeof tailscale !== 'object' || tailscale === null) return []
	const ports: unknown = Reflect.get(tailscale, 'ports')
	if (!Array.isArray(ports)) return []
	return ports.filter((port): port is number => typeof port === 'number')
}

/** The port the project reserves for wt's workspace index, null when it declares none. */
function readTailnetIndex(row: object): number | null {
	const config: unknown = Reflect.get(row, 'container_config')
	if (typeof config !== 'object' || config === null) return null
	const tailscale: unknown = Reflect.get(config, 'tailscale')
	if (typeof tailscale !== 'object' || tailscale === null) return null
	const index: unknown = Reflect.get(tailscale, 'index')
	if (typeof index !== 'number') return null
	return index
}

/** The recorded memory limit, shown so a starved VM is never a mystery. */
function readMemory(row: object): string {
	const config: unknown = Reflect.get(row, 'container_config')
	if (typeof config !== 'object' || config === null) return ''
	return stringField(config, 'memory') ?? ''
}

/** The provisioning vehicle the row records; rows from before the field are containers. */
function readVehicle(row: object): Vehicle {
	return stringField(row, 'vehicle') === 'devvm' ? 'devvm' : 'container'
}

/** Is `candidate` the workspace root or inside it? Both are canonical absolute paths. */
export function isInsideWorkspace(root: string, candidate: string): boolean {
	return candidate === root || candidate.startsWith(`${root}/`)
}

/** The deepest registered row containing `cwd`, which is the one that owns it. */
function deepestRow(
	rows: unknown[],
	cwd: string,
): { row: object; path: string } | null {
	let best: { row: object; path: string } | null = null
	for (const row of rows) {
		if (typeof row !== 'object' || row === null) continue
		const path = stringField(row, 'path')
		if (!path || !isInsideWorkspace(path, cwd)) continue
		if (!best || path.length > best.path.length) best = { row, path }
	}
	return best
}

/** A containerized row as the session sees it, vehicle included. */
function workspaceFromRow(row: object, path: string): SandboxWorkspace {
	const vehicle = readVehicle(row)
	return {
		path,
		branch: stringField(row, 'branch') ?? '',
		containerName: stringField(row, 'container_name') ?? '',
		vehicle,
		// A devvm workspace has no container state machine to read, and nothing it
		// publishes to the host or reserves alone: the shared VM owns both facts.
		containerState:
			vehicle === 'devvm'
				? 'unknown'
				: containerState(Reflect.get(row, 'container')),
		ports: vehicle === 'devvm' ? [] : readPorts(row),
		tailnetPorts: readTailnetPorts(row),
		tailnetIndex: readTailnetIndex(row),
		memory: vehicle === 'devvm' ? '' : readMemory(row),
	}
}

/** Deepest registered workspace containing `cwd`, containerized or not. */
export function locateWorkspace(rows: unknown, cwd: string): WorkspaceLookup {
	if (!Array.isArray(rows)) return { kind: 'missing' }
	const best = deepestRow(rows, cwd)
	if (!best) return { kind: 'missing' }
	if (Reflect.get(best.row, 'containerized') !== true)
		return { kind: 'plain' }
	const workspace = workspaceFromRow(best.row, best.path)
	if (!workspace.branch || !workspace.containerName) return { kind: 'plain' }
	return { kind: 'containerized', workspace }
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

/**
 * The JSON documents `output` may hold, newest first: the whole text, then each
 * line that could open one. A failing wt run streams its diagnostics before the
 * envelope, so the document is the trailing one.
 */
function* jsonDocuments(output: string): Generator<string> {
	yield output.trim()
	const starts: number[] = []
	let offset = 0
	for (const line of output.split('\n')) {
		if (line.trimStart().startsWith('{')) starts.push(offset)
		offset += line.length + 1
	}
	for (const start of starts.toReversed()) yield output.slice(start).trim()
}

/** The `error.message` of the wt JSON envelope in `output`, wherever wt printed it. */
function envelopeMessage(output: string): string | null {
	for (const candidate of jsonDocuments(output)) {
		let payload: unknown
		try {
			payload = JSON.parse(candidate)
		} catch {
			continue
		}
		if (typeof payload !== 'object' || payload === null) continue
		const envelope: unknown = Reflect.get(payload, 'error')
		if (typeof envelope !== 'object' || envelope === null) continue
		const message = stringField(envelope, 'message')
		if (message) return message
	}
	return null
}

/** The last informative line of plain-text output, wt's diagnostics tail. */
function plainTail(output: string): string | null {
	const lines = output
		.split('\n')
		.map(line => line.trim())
		.filter(line => line !== '' && !JSON_SYNTAX_ONLY_LINE.test(line))
	return lines.at(-1) ?? null
}

/**
 * Error text from a wt JSON envelope, then its plain-text tail, then the raw error.
 * Envelopes are read across both streams before any tail: the structured message
 * names the failure, where the tail may only be the last line of a chatty log.
 */
function failureReason(error: unknown): string {
	if (typeof error !== 'object' || error === null) return describe(error)
	const outputs = [
		stringField(error, 'stdout'),
		stringField(error, 'stderr'),
	].filter(
		(output): output is string => output !== null && output.trim() !== '',
	)
	for (const output of outputs) {
		const message = envelopeMessage(output)
		if (message) return message
	}
	for (const output of outputs) {
		const tail = plainTail(output)
		if (tail) return tail
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
	return syncWorkspace(workspace.path)
}

/**
 * Reconcile a devvm workspace: the idempotent `wt devvm add` behind `wt sync`
 * ensures the VM, the namespace and the relays. There is no state to consult -
 * the add is the state machine.
 */
export async function ensureDevvmRunning(path: string): Promise<string | null> {
	return syncWorkspace(path)
}

async function syncWorkspace(path: string): Promise<string | null> {
	try {
		return syncOutcome(await wtJson(['sync', path, '--json'], path))
	} catch (error) {
		return `wt sync failed: ${failureReason(error)}`
	}
}
