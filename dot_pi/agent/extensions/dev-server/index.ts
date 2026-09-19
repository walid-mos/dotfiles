/**
 * dev-server - stack-agnostic lifecycle tool for background dev servers.
 *
 * Replaces the hand-rolled `setsid nohup pnpm dev > /tmp/x.log 2>&1 &` plus
 * curl-polling pattern. `start` runs any dev command detached (pnpm, npm,
 * cargo, uv, go - the command is never parsed), records a per-project
 * pidfile + log under /tmp/pi-dev-server/<cwd-slug>/, and waits on real
 * signals only: the process death ends the wait immediately with the log
 * tail, readiness is a readyPattern regex on the log (an explicit pattern
 * replaces the generic localhost/listening defaults), a healthUrl probe or a
 * TCP port probe, bounded by timeoutMs. `stop` kills the recorded process
 * group (SIGTERM, then SIGKILL after a grace). `status` reports the slot.
 *
 * Where it runs is decided per call: with a sandboxed session (bash routed
 * into an Apple container VM or dev VM) the launch goes through the sandbox's
 * own exec boundary - `container-sandbox/runtime.ts` exports it, reading the
 * runtime that extension published on globalThis - so the server, its pid, its
 * ports and its log live in the guest, and every outcome says `where: 'guest'`.
 * Without that boundary it runs on the host.
 *
 * Modules:
 *   probe.ts          - readiness probes, log reading, URL extraction
 *   runtime.ts        - host backend: start/wait/stop/status flows
 *   guest-commands.ts - guest script builders and the verdict protocol
 *   guest-backend.ts  - sandboxed backend: one guest call per action
 *   state.ts          - slot paths, pidfile records, liveness
 */
import { resolve } from 'node:path'

import { StringEnum } from '@earendil-works/pi-ai'
import { Type } from 'typebox'

import { sandboxBashOperations } from '../container-sandbox/runtime.ts'

import {
	startServerInGuest,
	statusInGuest,
	stopServerInGuest,
} from './guest-backend.ts'
import { startServer, statusOf, stopServer } from './runtime.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { Static } from 'typebox'
import type { ServerOutcome, StartRequest } from './runtime.ts'

const DEFAULT_TIMEOUT_MS = 120_000
const MIN_TIMEOUT_MS = 5_000
const MAX_TIMEOUT_MS = 300_000
const MIN_PORT_NUMBER = 1
const MAX_PORT_NUMBER = 65_535
const MS_PER_SECOND = 1_000

const TOOL_DESCRIPTION = `Start, stop or inspect a background dev server, stack-agnostic (pnpm, npm, cargo, uv, go, ... - the command is never parsed).

start (default): runs "command" detached, logging to /tmp/pi-dev-server/<cwd-slug>/server.log, then waits for a real readiness signal: readyPattern regex on the log (when omitted, generic defaults apply: any localhost URL, "listening", "ready in", "startup complete"), healthUrl HTTP probe, and/or TCP port probe. If the process dies while waiting, fails immediately with the log tail - it never polls a dead server. If the project slot already holds a live server or the port is already served, reports already-running instead of double-starting. Bounded by timeoutMs (default 120s, max 300s); on timeout the process is left running and the log is reported. Returns pid, printed URL and log path.

stop: kills the recorded process group (SIGTERM, then SIGKILL after 3s). status: reports pid, URL and log tail.

Execution target: when the session is sandboxed (bash routed into an Apple container VM or a shared dev VM), start/stop/status run inside that guest through the same boundary the bash tool uses - the pid, the port and the log are the VM's own, the log path is the same /tmp slot inside the VM, readyPattern is evaluated by the guest's grep -E, and every result says (in VM). The reported URL is the VM's localhost view; the sandbox section of the system prompt owns the human-facing address. Outside a sandbox everything runs on the macOS host.

Prefer this over a hand-rolled "setsid nohup ... &" plus curl loop: it cannot block on a crashed server and reports the actual startup error from the log.`

const toolParameters = Type.Object({
	action: Type.Optional(
		StringEnum(['start', 'stop', 'status'], {
			description: 'start (default), stop or status.',
		}),
	),
	command: Type.Optional(
		Type.String({
			description:
				'Full dev command run detached, e.g. "pnpm dev", "npm run dev", "cargo run", "uv run uvicorn main:app". Required for start.',
		}),
	),
	cwd: Type.Optional(
		Type.String({
			description:
				'Project directory the command runs in; defaults to the session working directory.',
		}),
	),
	readyPattern: Type.Optional(
		Type.String({
			description:
				'Regex the server log must match to count as ready; replaces the generic defaults. Examples: "Uvicorn running on", "Application startup complete".',
		}),
	),
	port: Type.Optional(
		Type.Number({
			description:
				'TCP port probed for readiness and for already-running detection before start, e.g. 5173.',
		}),
	),
	healthUrl: Type.Optional(
		Type.String({
			description:
				'HTTP URL polled until it answers 2xx, e.g. http://localhost:3000/health.',
		}),
	),
	timeoutMs: Type.Optional(
		Type.Number({
			description:
				'Wait ceiling in milliseconds. Default 120000, max 300000.',
		}),
	),
})

type ToolParams = Static<typeof toolParameters>

function clampTimeout(timeoutMs: number | undefined): number {
	const raw = timeoutMs ?? DEFAULT_TIMEOUT_MS
	return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, raw))
}

function assertValidPort(port: number | undefined): void {
	if (!port) return
	if (
		!Number.isInteger(port) ||
		port < MIN_PORT_NUMBER ||
		port > MAX_PORT_NUMBER
	) {
		throw new Error(`Invalid port ${port}: expected an integer in 1-65535`)
	}
}

async function runTool(
	params: ToolParams,
	cwd: string,
	abort: AbortSignal | undefined,
): Promise<ServerOutcome> {
	const sandbox = sandboxBashOperations()
	if (params.action === 'stop') {
		return sandbox
			? stopServerInGuest(sandbox, cwd, abort)
			: stopServer(cwd)
	}
	if (params.action === 'status') {
		return sandbox ? statusInGuest(sandbox, cwd, abort) : statusOf(cwd)
	}
	if (!params.command?.trim()) {
		throw new Error(
			'dev_server start requires "command" (e.g. "pnpm dev", "cargo run", "uv run uvicorn main:app")',
		)
	}
	assertValidPort(params.port)
	const request: StartRequest = {
		command: params.command,
		cwd,
		readyPattern: params.readyPattern,
		port: params.port,
		healthUrl: params.healthUrl,
		timeoutMs: clampTimeout(params.timeoutMs),
		abort,
	}
	return sandbox
		? startServerInGuest(sandbox, request, abort)
		: startServer(request)
}

function formatSeconds(ms: number | undefined): string {
	return `${((ms ?? 0) / MS_PER_SECOND).toFixed(1)}s`
}

function joinLines(lines: Array<string | undefined>): string {
	return lines.filter((line): line is string => Boolean(line)).join('\n')
}

/** The pid, URL and log live in the VM when the launch did. */
function inGuest(outcome: ServerOutcome): string {
	return outcome.where === 'guest' ? ' (in VM)' : ''
}

/** The same fact inside an open parenthesis: "pid 123, in VM". */
function inGuestClause(outcome: ServerOutcome): string {
	return outcome.where === 'guest' ? ', in VM' : ''
}

function renderFailure(outcome: ServerOutcome): string {
	const head =
		outcome.status === 'crashed'
			? `Dev server crashed after ${formatSeconds(outcome.elapsedMs)}${outcome.exit ? ` (${outcome.exit})` : ''}.`
			: `Dev server not ready within ${formatSeconds(outcome.elapsedMs)} (pid ${outcome.pid} still running${inGuestClause(outcome)}).`
	return joinLines([
		head,
		`Command: ${outcome.command}`,
		`Log${inGuest(outcome)}: ${outcome.logPath}`,
		'Last log lines:',
		outcome.logTail ?? '(empty log)',
	])
}

function renderOutcome(outcome: ServerOutcome, cwd: string): string {
	switch (outcome.status) {
		case 'ready':
			return joinLines([
				`Dev server ready in ${formatSeconds(outcome.elapsedMs)} (pid ${outcome.pid}${inGuestClause(outcome)}).`,
				`Command: ${outcome.command}`,
				outcome.url
					? `URL${inGuest(outcome)}: ${outcome.url}`
					: undefined,
				`Log${inGuest(outcome)}: ${outcome.logPath}`,
				'Last log lines:',
				outcome.logTail,
			])
		case 'already-running':
			return joinLines([
				outcome.pid
					? `Dev server already running (pid ${outcome.pid}${inGuestClause(outcome)}) - not started twice.`
					: 'Something already serves this port - nothing started.',
				outcome.command ? `Command: ${outcome.command}` : undefined,
				outcome.url
					? `URL${inGuest(outcome)}: ${outcome.url}`
					: undefined,
				`Log${inGuest(outcome)}: ${outcome.logPath}`,
				outcome.logTail ? 'Last log lines:' : undefined,
				outcome.logTail,
			])
		case 'cancelled':
			return joinLines([
				outcome.pid
					? `Cancelled while waiting; dev server left running (pid ${outcome.pid}${inGuestClause(outcome)}).`
					: 'Cancelled while waiting; the dev server is left running.',
				`Log${inGuest(outcome)}: ${outcome.logPath}`,
			])
		case 'stopped':
			return joinLines([
				`Dev server stopped (pid ${outcome.pid}${inGuestClause(outcome)}).`,
				`Log${inGuest(outcome)}: ${outcome.logPath}`,
			])
		case 'none':
			return joinLines([
				`No dev server recorded for ${cwd}.`,
				outcome.logTail ? 'Last log lines:' : undefined,
				outcome.logTail,
			])
		case 'crashed':
		case 'timeout':
			return renderFailure(outcome)
	}
}

export default function devServer(pi: ExtensionAPI): void {
	pi.registerTool({
		name: 'dev_server',
		label: 'Dev Server',
		description: TOOL_DESCRIPTION,
		promptSnippet:
			'Start/stop/status a dev server detached with crash detection and log-based readiness (any stack, host or sandbox)',
		promptGuidelines: [
			'Use dev_server instead of a "setsid nohup ... &" plus curl polling loop to launch dev servers: it fails fast when the process crashes, matches readiness from the log, and reports the real startup error - in the session\'s sandbox when one is active.',
		],
		parameters: toolParameters,
		// oxlint-disable-next-line max-params - pi's fixed tool execute signature (toolCallId, params, signal, onUpdate, ctx)
		execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
			const cwd = resolve(ctx.cwd, (params.cwd ?? '.').replace(/^@/, ''))
			const outcome = await runTool(params, cwd, signal)
			if (outcome.status === 'crashed' || outcome.status === 'timeout') {
				throw new Error(renderFailure(outcome))
			}
			return {
				content: [
					{
						type: 'text' as const,
						text: renderOutcome(outcome, cwd),
					},
				],
				details: outcome,
			}
		},
	})
}
