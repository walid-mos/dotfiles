/**
 * dev-server runtime flows: start-and-wait, stop, status.
 *
 * The start watcher polls only real signals: the child's exit event (a crash
 * ends the wait immediately, with the log tail as the answer), the log
 * patterns, the health URL and the TCP port. The bounded timeout is the
 * ceiling that fires only while the process is alive but silent.
 */
import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync } from 'node:fs'

import {
	DEFAULT_READY_PATTERNS,
	compileReadyPattern,
	extractUrl,
	isHealthOk,
	isLogReady,
	isPortServing,
	readLogTail,
	tailLines,
} from './probe.ts'
import {
	clearRecord,
	isProcessAlive,
	readRecord,
	slotPaths,
	writeRecord,
} from './state.ts'

import type { ChildProcess } from 'node:child_process'
import type { ServerRecord, SlotPaths } from './state.ts'

const POLL_INTERVAL_MS = 300
const KILL_GRACE_MS = 3_000
const KILL_POLL_MS = 100

export type ServerStatus =
	| 'ready'
	| 'already-running'
	| 'crashed'
	| 'timeout'
	| 'cancelled'
	| 'stopped'
	| 'none'

export interface StartRequest {
	command: string
	cwd: string
	readyPattern?: string | undefined
	port?: number | undefined
	healthUrl?: string | undefined
	timeoutMs: number
	abort?: AbortSignal | undefined
}

export interface ServerOutcome {
	status: ServerStatus
	/** Where the server runs; absent means the host. */
	where?: 'host' | 'guest' | undefined
	pid?: number | undefined
	command?: string | undefined
	logPath?: string | undefined
	url?: string | undefined
	logTail?: string | undefined
	elapsedMs?: number | undefined
	exit?: string | undefined
}

export interface WaitSpec {
	child: ChildProcess
	request: StartRequest
	readyPatterns: readonly RegExp[]
	paths: SlotPaths
	startedAt: number
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms))
}

/** Start the command detached, then wait for a real signal: ready, death or timeout. */
export async function startServer(
	request: StartRequest,
): Promise<ServerOutcome> {
	const readyPatterns = request.readyPattern
		? [compileReadyPattern(request.readyPattern)]
		: DEFAULT_READY_PATTERNS
	const paths = slotPaths(request.cwd)
	const startedAt = Date.now()

	const existing = readRecord(paths.pidfile)
	if (existing && isProcessAlive(existing.pid)) return liveOutcome(existing)
	clearRecord(paths.pidfile)
	if (request.port && (await isPortServing(request.port))) {
		return {
			status: 'already-running',
			logPath: paths.log,
			logTail: tailLines(readLogTail(paths.log)),
		}
	}
	const child = launchAndRecord(request, paths)
	return waitForServer({ child, request, readyPatterns, paths, startedAt })
}

function launchAndRecord(
	request: StartRequest,
	paths: SlotPaths,
): ChildProcess {
	mkdirSync(paths.dir, { recursive: true })
	const logFd = openSync(paths.log, 'w')
	const child = spawn('/bin/sh', ['-c', request.command], {
		cwd: request.cwd,
		detached: true,
		stdio: ['ignore', logFd, logFd],
	})
	closeSync(logFd)
	if (child.pid) {
		writeRecord(paths.pidfile, {
			pid: child.pid,
			command: request.command,
			cwd: request.cwd,
			startedAt: Date.now(),
			logPath: paths.log,
		})
	}
	return child
}

async function waitForServer(spec: WaitSpec): Promise<ServerOutcome> {
	const exit = captureExit(spec.child)
	while (Date.now() - spec.startedAt < spec.request.timeoutMs) {
		// oxlint-disable-next-line no-await-in-loop - sequential poll tick: one observation instant per tick
		await sleep(POLL_INTERVAL_MS)
		const logText = readLogTail(spec.paths.log)
		if (exit.report) return crashedOutcome(spec, exit.report)
		// oxlint-disable-next-line no-await-in-loop - readiness probes run one per tick, in priority order
		if (await isServerReady(spec, logText)) return readyOutcome(spec)
		if (spec.request.abort?.aborted)
			return unfinishedOutcome(spec, 'cancelled')
	}
	return unfinishedOutcome(spec, 'timeout')
}

/** One poll tick: the first live readiness signal wins. */
async function isServerReady(
	spec: WaitSpec,
	logText: string,
): Promise<boolean> {
	if (isLogReady(logText, spec.readyPatterns)) return true
	if (spec.request.healthUrl && (await isHealthOk(spec.request.healthUrl)))
		return true
	return Boolean(
		spec.request.port && (await isPortServing(spec.request.port)),
	)
}

/** Records the child's death the moment it happens; polled by the wait loop. */
function captureExit(child: ChildProcess): { report?: { message: string } } {
	const exit: { report?: { message: string } } = {}
	child.on('exit', (code, signalName) => {
		exit.report = {
			message:
				code === null
					? `killed by signal ${signalName}`
					: `exit code ${code}`,
		}
	})
	child.on('error', (error: Error) => {
		exit.report = { message: `spawn failed: ${error.message}` }
	})
	return exit
}

/** Outcome for a live server already holding the slot. */
function liveOutcome(record: ServerRecord): ServerOutcome {
	const logText = readLogTail(record.logPath)
	return {
		status: 'already-running',
		pid: record.pid,
		command: record.command,
		logPath: record.logPath,
		url: extractUrl(logText),
		logTail: tailLines(logText),
	}
}

function readyOutcome(spec: WaitSpec): ServerOutcome {
	const logText = readLogTail(spec.paths.log)
	return {
		status: 'ready',
		pid: spec.child.pid,
		command: spec.request.command,
		logPath: spec.paths.log,
		url: extractUrl(logText),
		logTail: tailLines(logText),
		elapsedMs: Date.now() - spec.startedAt,
	}
}

function crashedOutcome(
	spec: WaitSpec,
	report: { message: string },
): ServerOutcome {
	clearRecord(spec.paths.pidfile)
	return {
		status: 'crashed',
		pid: spec.child.pid,
		command: spec.request.command,
		logPath: spec.paths.log,
		logTail: tailLines(readLogTail(spec.paths.log)),
		elapsedMs: Date.now() - spec.startedAt,
		exit: report.message,
	}
}

function unfinishedOutcome(
	spec: WaitSpec,
	status: 'timeout' | 'cancelled',
): ServerOutcome {
	return {
		status,
		pid: spec.child.pid,
		command: spec.request.command,
		logPath: spec.paths.log,
		logTail: tailLines(readLogTail(spec.paths.log)),
		elapsedMs: Date.now() - spec.startedAt,
	}
}

/** Kill the recorded process group, escalating to SIGKILL after the grace. */
export async function stopServer(cwd: string): Promise<ServerOutcome> {
	const paths = slotPaths(cwd)
	const record = readRecord(paths.pidfile)
	if (!record || !isProcessAlive(record.pid)) {
		clearRecord(paths.pidfile)
		return {
			status: 'none',
			logPath: record?.logPath ?? paths.log,
			logTail: record
				? tailLines(readLogTail(record.logPath))
				: undefined,
		}
	}
	await terminate(record.pid)
	clearRecord(paths.pidfile)
	return {
		status: 'stopped',
		pid: record.pid,
		command: record.command,
		logPath: record.logPath,
	}
}

function signalGroup(pid: number, signal: 'SIGTERM' | 'SIGKILL'): void {
	try {
		process.kill(-pid, signal) // detached spawn: the pid leads its own group
	} catch {
		// process group already gone
	}
}

async function terminate(pid: number): Promise<void> {
	signalGroup(pid, 'SIGTERM')
	const deadline = Date.now() + KILL_GRACE_MS
	while (Date.now() < deadline && isProcessAlive(pid)) {
		// oxlint-disable-next-line no-await-in-loop - bounded grace poll on the process's own death
		await sleep(KILL_POLL_MS)
	}
	if (isProcessAlive(pid)) signalGroup(pid, 'SIGKILL')
}

/** Inspect the slot without touching anything. */
export function statusOf(cwd: string): ServerOutcome {
	const paths = slotPaths(cwd)
	const record = readRecord(paths.pidfile)
	if (!record) return { status: 'none', logPath: paths.log }
	if (!isProcessAlive(record.pid)) {
		clearRecord(paths.pidfile)
		return {
			status: 'none',
			logPath: record.logPath,
			logTail: tailLines(readLogTail(record.logPath)),
		}
	}
	return liveOutcome(record)
}
