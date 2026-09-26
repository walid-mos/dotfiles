/** The herdr boundary: the only workspace-extension code that talks to herdr. */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const READ_TIMEOUT_MS = 15_000
/** The CLI's own readiness/settle wait; herdr answers its own errors within it. */
const AGENT_TIMEOUT_MS = 30_000
/** The wrapper kill must never race the CLI's wait, or a killed CLI leaves a stale record. */
const CHILD_KILL_MARGIN_MS = 20_000
const MAX_OUTPUT_BYTES = 8_388_608

export class HerdrFailed extends Error {}

export interface PaneInfo {
	paneId: string
	cwd: string
	workspaceId: string
	agent: string | null
}

/** The herdr answer contract: its `result` document, or a HerdrFailed with its own text. */
async function herdrResult(args: string[], timeoutMs: number): Promise<object> {
	try {
		const { stdout } = await execFileAsync('herdr', args, {
			timeout: timeoutMs,
			maxBuffer: MAX_OUTPUT_BYTES,
		})
		return parseReply(stdout, args[0] ?? 'herdr')
	} catch (error) {
		if (error instanceof HerdrFailed) throw error
		throw new HerdrFailed(herdrFailureText(args[0] ?? 'herdr', error))
	}
}

/** herdr prints one `{id, result}` document; only `result` answers. */
function parseReply(stdout: string, operation: string): object {
	const parsed: unknown = JSON.parse(stdout)
	if (typeof parsed !== 'object' || parsed === null) {
		throw new HerdrFailed(`herdr ${operation} answered no result document`)
	}
	const reply: unknown = Reflect.get(parsed, 'result')
	if (typeof reply !== 'object' || reply === null) {
		throw new HerdrFailed(`herdr ${operation} answered no result document`)
	}
	return reply
}

function herdrFailureText(operation: string, error: unknown): string {
	if (!(error instanceof Error)) return `herdr ${operation} failed`
	const streams = ['stderr', 'stdout'].map(key => streamText(error, key))
	return streams.find(text => text.length) ?? error.message
}

/** A child-process stream as trimmed text; Node puts the CLI's own words there. */
function streamText(error: Error, key: string): string {
	const stream: unknown = Reflect.get(error, key)
	return typeof stream === 'string' ? stream.trim() : ''
}

function stringField(source: object | null, key: string): string {
	if (source === null) return ''
	const fieldValue: unknown = Reflect.get(source, key)
	return typeof fieldValue === 'string' ? fieldValue : ''
}

/** One snapshot of every live pane: id, cwd, workspace and detected agent. */
export async function snapshotPanes(): Promise<PaneInfo[]> {
	const reply = await herdrResult(['api', 'snapshot'], READ_TIMEOUT_MS)
	const snapshot: unknown = Reflect.get(reply, 'snapshot')
	const panes: unknown =
		typeof snapshot === 'object' && snapshot !== null
			? Reflect.get(snapshot, 'panes')
			: undefined
	if (!Array.isArray(panes)) {
		throw new HerdrFailed(
			'herdr api snapshot answered without a panes array',
		)
	}
	return panes.flatMap(pane => {
		if (typeof pane !== 'object' || pane === null) return []
		const paneId = stringField(pane, 'pane_id')
		if (!paneId.length) return []
		const agent: unknown = Reflect.get(pane, 'agent')
		return [
			{
				paneId,
				cwd: stringField(pane, 'cwd'),
				workspaceId: stringField(pane, 'workspace_id'),
				agent: typeof agent === 'string' ? agent : null,
			},
		]
	})
}

/** Start plain Pi in the pane and wait until the TUI answers input. */
export async function startPi(name: string, paneId: string): Promise<void> {
	await herdrResult(
		[
			'agent',
			'start',
			name,
			'--kind',
			'pi',
			'--pane',
			paneId,
			'--timeout',
			String(AGENT_TIMEOUT_MS),
		],
		AGENT_TIMEOUT_MS + CHILD_KILL_MARGIN_MS,
	)
}

/** Submit the first prompt to the started agent and wait for it to take the turn. */
export async function promptPi(name: string, text: string): Promise<void> {
	await herdrResult(
		[
			'agent',
			'prompt',
			name,
			text,
			'--wait',
			'--timeout',
			String(AGENT_TIMEOUT_MS),
		],
		AGENT_TIMEOUT_MS + CHILD_KILL_MARGIN_MS,
	)
}
