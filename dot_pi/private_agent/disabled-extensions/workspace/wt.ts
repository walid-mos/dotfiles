/** The wt boundary: the only workspace-extension code that runs the wt CLI. */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const LIST_TIMEOUT_MS = 15_000
const SPAWN_TIMEOUT_MS = 60_000
const MAX_OUTPUT_BYTES = 8_388_608

export class WtFailed extends Error {}

export interface WorkspaceRow {
	path: string
	repo: string
	branch: string
}

export interface Checkout {
	path: string
	branch: string
	surfaceId: string
}

export interface SpawnOptions {
	base: string | null
	shouldCarry: boolean
	shouldFocus: boolean
}

/** The wt answer contract: wt's own human message, whatever it refused. */
async function wtEnvelope(
	args: string[],
	cwd: string,
	timeoutMs: number,
): Promise<object> {
	try {
		const { stdout } = await execFileAsync('wt', args, {
			cwd,
			timeout: timeoutMs,
			maxBuffer: MAX_OUTPUT_BYTES,
		})
		return parseEnvelope(stdout)
	} catch (error) {
		throw new WtFailed(wtFailureText(args[0] ?? 'wt', error))
	}
}

/** wt prints one JSON document on stdout and its own diagnostics on stderr. */
function parseEnvelope(stdout: string): object {
	const text = stdout.trim()
	if (!text.startsWith('{')) {
		throw new WtFailed(`wt answered no JSON document: ${firstLine(text)}`)
	}
	const parsed: unknown = safeParse(text)
	if (
		typeof parsed !== 'object' ||
		parsed === null ||
		Reflect.get(parsed, 'ok') !== true
	) {
		throw new WtFailed(envelopeText(parsed, text))
	}
	return parsed
}

function envelopeText(parsed: unknown, rawText: string): string {
	if (typeof parsed === 'object' && parsed !== null) {
		const message = stringField(objectField(parsed, 'error'), 'message')
		if (message.length) return message
	}
	return firstLine(rawText)
}

function wtFailureText(operation: string, error: unknown): string {
	if (error instanceof WtFailed) return error.message
	const stdout =
		error instanceof Error ? Reflect.get(error, 'stdout') : undefined
	const trimmed = typeof stdout === 'string' ? stdout.trim() : ''
	const parsed = trimmed.startsWith('{') ? safeParse(trimmed) : null
	if (parsed !== null) {
		const envelope = envelopeText(parsed, trimmed)
		if (envelope !== firstLine(trimmed)) return envelope
	}
	const stderr =
		error instanceof Error ? Reflect.get(error, 'stderr') : undefined
	const stderrText = typeof stderr === 'string' ? stderr.trim() : ''
	return (
		stderrText ||
		(error instanceof Error ? error.message : `wt ${operation} failed`)
	)
}

function objectField(source: object, key: string): object | null {
	const fieldValue: unknown = Reflect.get(source, key)
	if (typeof fieldValue !== 'object' || fieldValue === null) return null
	return fieldValue
}

function stringField(source: object | null, key: string): string {
	if (source === null) return ''
	const fieldValue: unknown = Reflect.get(source, key)
	return typeof fieldValue === 'string' ? fieldValue : ''
}

function safeParse(text: string): unknown {
	try {
		return JSON.parse(text)
	} catch {
		return null
	}
}

function firstLine(text: string): string {
	const line = text.split('\n', 1)[0]?.trim() ?? ''
	return line.length ? line : '(empty)'
}

/** Every checkout wt knows for the repository the caller stands in. */
export async function listWorkspaces(cwd: string): Promise<WorkspaceRow[]> {
	const envelope = await wtEnvelope(['list', '--json'], cwd, LIST_TIMEOUT_MS)
	const workspaces: unknown = Reflect.get(envelope, 'workspaces')
	if (!Array.isArray(workspaces)) {
		throw new WtFailed('wt list answered without a workspaces array')
	}
	return workspaces.flatMap(row => {
		const path = stringField(row, 'path')
		const branch = stringField(row, 'branch')
		if (!path.length || !branch.length) return []
		return [{ path, repo: stringField(row, 'repo'), branch }]
	})
}

/**
 * Create the checkout on a new, adopted or remote-tracking branch and attach its
 * herdr workspace. Provisioning stays detached (--async): the pane and Pi start
 * while the init and spawn hooks keep running in the background.
 */
export async function spawnWorkspace(
	branch: string,
	options: SpawnOptions,
	cwd: string,
): Promise<Checkout> {
	const args = ['spawn', branch, '--pane', '--json', '--async']
	if (options.base) args.push('--base', options.base)
	if (options.shouldCarry) args.push('--carry')
	args.push(options.shouldFocus ? '--focus' : '--no-focus')
	const envelope = await wtEnvelope(args, cwd, SPAWN_TIMEOUT_MS)
	return checkoutFromRow(Reflect.get(envelope, 'workspace'), branch)
}

/** Bring the checkout that already holds the branch back up, focused like a spawn. */
export async function switchWorkspace(
	checkoutPath: string,
	shouldFocus: boolean,
	cwd: string,
): Promise<Checkout> {
	const args = [
		'switch',
		checkoutPath,
		'--json',
		shouldFocus ? '--focus' : '--no-focus',
	]
	const envelope = await wtEnvelope(args, cwd, SPAWN_TIMEOUT_MS)
	return checkoutFromRow(Reflect.get(envelope, 'switched'), '')
}

function checkoutFromRow(row: unknown, fallbackBranch: string): Checkout {
	if (typeof row !== 'object' || row === null) {
		throw new WtFailed('wt answered without a checkout document')
	}
	const path = stringField(row, 'path')
	const surfaceId = stringField(objectField(row, 'surface'), 'workspace_id')
	if (!path.length) throw new WtFailed('wt answered without a checkout path')
	if (!surfaceId.length) {
		throw new WtFailed(
			`wt opened no herdr workspace for ${path}; retry with: wt open ${path}`,
		)
	}
	return {
		path,
		branch: stringField(row, 'branch') || fallbackBranch,
		surfaceId,
	}
}
