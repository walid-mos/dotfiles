/**
 * The sandboxed backend: one guest call per action, through the same exec
 * boundary the bash tool uses - liveness guard, host-to-guest path mapping and
 * actionable failure text included, so a starved VM fails fast instead of
 * holding the call. The wait runs inside the guest, where the server's log and
 * process live; polling from the host would cost one container CLI round-trip
 * per tick. `where: 'guest'` tells the renderer the pid, URL and log path are
 * the VM's own.
 */
import {
	guestStartScript,
	guestStatusScript,
	guestStopScript,
	parseGuestReport,
} from './guest-commands.ts'
import { extractUrl } from './probe.ts'
import { guestSlotPaths } from './state.ts'

import type { BashOperations } from '@earendil-works/pi-coding-agent'
import type { GuestReport } from './guest-commands.ts'
import type { ServerOutcome, StartRequest } from './runtime.ts'
import type { GuestSlotPaths } from './state.ts'

const MS_PER_SECOND = 1_000
/** Bounded output: the server's own log tail must fit, and so must nothing else. */
const OUTPUT_LIMIT_BYTES = 64_000
/** The guest wrapper's deadline outlives the script's own verdict by this margin. */
const WRAPPER_GRACE_SECONDS = 10
/** Stop and status do control work only: no wait, so a short budget. */
const CONTROL_TIMEOUT_SECONDS = 30
/** Below this a guest call could not even start a process and read its log. */
const MIN_GUEST_TIMEOUT_SECONDS = 5

interface GuestCall {
	ops: BashOperations
	script: string
	/** Host path of the worktree; the sandbox maps it to its guest path. */
	cwd: string
	timeoutSeconds: number
	signal?: AbortSignal | undefined
}

/** Collect a guest script's output. pi's option objects forbid explicit undefined. */
async function runGuestCall(call: GuestCall): Promise<string> {
	const chunks: Buffer[] = []
	let size = 0
	const onData = (chunk: Buffer): void => {
		const room = OUTPUT_LIMIT_BYTES - size
		if (room <= 0) return
		const kept = chunk.length > room ? chunk.subarray(0, room) : chunk
		chunks.push(kept)
		size += kept.length
	}
	const options: {
		onData: (chunk: Buffer) => void
		signal?: AbortSignal
		timeout?: number
	} = { onData }
	if (call.signal) options.signal = call.signal
	if (call.timeoutSeconds) options.timeout = call.timeoutSeconds
	await call.ops.exec(call.script, call.cwd, options)
	return Buffer.concat(chunks).toString('utf8')
}

function sandboxFailure(error: unknown): Error {
	const message = error instanceof Error ? error.message : String(error)
	return new Error(`Dev server could not run in the sandbox: ${message}`, {
		cause: error,
	})
}

/** The fields every guest outcome carries, whatever the verdict. */
type OutcomeBase = Pick<ServerOutcome, 'command' | 'logPath' | 'where'>

function guestBase(
	paths: GuestSlotPaths,
	command: string | undefined,
): OutcomeBase {
	return { command, logPath: paths.log, where: 'guest' }
}

/** A start verdict, mapped onto the same outcomes the host backend reports. */
function startOutcome(
	output: string,
	paths: GuestSlotPaths,
	command: string,
	elapsedMs: number,
): ServerOutcome {
	const { report, logTail } = parseGuestReport(output)
	const base = guestBase(paths, command)
	if (!report) {
		return {
			...base,
			status: 'crashed',
			elapsedMs,
			logTail,
			exit: 'the guest produced no verdict (see log)',
		}
	}
	return verdictOutcome(report, base, logTail)
}

/** The outcome for a verdict that did arrive, in the host backend's vocabulary. */
function verdictOutcome(
	report: GuestReport,
	base: OutcomeBase,
	logTail: string,
): ServerOutcome {
	if (report.status === 'ready') {
		return {
			...base,
			status: 'ready',
			pid: report.pid,
			elapsedMs: report.elapsedMs,
			url: extractUrl(logTail),
			logTail,
		}
	}
	if (report.status === 'already-running') {
		return {
			...base,
			status: 'already-running',
			pid: report.pid,
			url: extractUrl(logTail),
			logTail,
		}
	}
	if (report.status === 'timeout') {
		return {
			...base,
			status: 'timeout',
			pid: report.pid,
			elapsedMs: report.elapsedMs,
			logTail,
		}
	}
	return {
		...base,
		status: 'crashed',
		pid: report.pid,
		elapsedMs: report.elapsedMs,
		logTail,
		exit:
			report.status === 'crashed'
				? 'the process exited during startup'
				: `unexpected guest verdict ${report.status}`,
	}
}

export async function startServerInGuest(
	ops: BashOperations,
	request: StartRequest,
	signal: AbortSignal | undefined,
): Promise<ServerOutcome> {
	const paths = guestSlotPaths(request.cwd)
	const timeoutSeconds = Math.max(
		MIN_GUEST_TIMEOUT_SECONDS,
		Math.ceil(request.timeoutMs / MS_PER_SECOND),
	)
	const startedAt = Date.now()
	try {
		const output = await runGuestCall({
			ops,
			cwd: request.cwd,
			signal,
			timeoutSeconds: timeoutSeconds + WRAPPER_GRACE_SECONDS,
			script: guestStartScript({
				command: request.command,
				paths,
				readyPattern: request.readyPattern,
				port: request.port,
				healthUrl: request.healthUrl,
				timeoutSeconds,
			}),
		})
		return startOutcome(
			output,
			paths,
			request.command,
			Date.now() - startedAt,
		)
	} catch (error) {
		if (signal?.aborted) {
			return {
				status: 'cancelled',
				command: request.command,
				logPath: paths.log,
				where: 'guest',
			}
		}
		throw sandboxFailure(error)
	}
}

export async function stopServerInGuest(
	ops: BashOperations,
	cwd: string,
	signal: AbortSignal | undefined,
): Promise<ServerOutcome> {
	const paths = guestSlotPaths(cwd)
	const output = await runControlCall({
		ops,
		cwd,
		signal,
		timeoutSeconds: CONTROL_TIMEOUT_SECONDS,
		script: guestStopScript(paths),
	})
	const { report } = parseGuestReport(output)
	if (report?.status === 'stopped') {
		return {
			status: 'stopped',
			pid: report.pid,
			logPath: paths.log,
			where: 'guest',
		}
	}
	if (report?.status === 'none')
		return { status: 'none', logPath: paths.log, where: 'guest' }
	throw new Error('dev_server stop: the guest produced no verdict')
}

export async function statusInGuest(
	ops: BashOperations,
	cwd: string,
	signal: AbortSignal | undefined,
): Promise<ServerOutcome> {
	const paths = guestSlotPaths(cwd)
	const output = await runControlCall({
		ops,
		cwd,
		signal,
		timeoutSeconds: CONTROL_TIMEOUT_SECONDS,
		script: guestStatusScript(paths),
	})
	const { report, logTail } = parseGuestReport(output)
	if (report?.status === 'running') {
		return {
			status: 'already-running',
			pid: report.pid,
			logPath: paths.log,
			url: extractUrl(logTail),
			logTail,
			where: 'guest',
		}
	}
	if (report?.status === 'none') {
		return { status: 'none', logPath: paths.log, logTail, where: 'guest' }
	}
	throw new Error('dev_server status: the guest produced no verdict')
}

async function runControlCall(call: GuestCall): Promise<string> {
	try {
		return await runGuestCall(call)
	} catch (error) {
		throw sandboxFailure(error)
	}
}
