/**
 * dev-server readiness probes and log reading - stack-agnostic on purpose.
 *
 * Readiness is whatever real signal the caller provides: a regex matched on
 * the server's own log (Vite prints its URL, uvicorn prints "running on",
 * warp prints "listening on"), an HTTP health URL, or a TCP port. No probe
 * knows which package manager or language produced the output.
 */
import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { createConnection } from 'node:net'

/** Log bytes kept for pattern matching; older output has stopped mattering. */
const LOG_MATCH_WINDOW_BYTES = 200_000
const TAIL_LINE_COUNT = 30
const TAIL_MAX_CHARS = 4_000
const PORT_PROBE_TIMEOUT_MS = 500
const HEALTH_TIMEOUT_MS = 2_000

/**
 * Generic readiness forms printed by most dev servers, whatever the stack:
 * a bound localhost URL, a listening line, a ready-in line, startup complete.
 * Kept as sources valid in both engines - JS RegExp here, `grep -E` in the
 * sandboxed backend - so the two paths never drift apart.
 */
export const DEFAULT_READY_PATTERN_SOURCES = [
	'https?://(localhost|127\\.0\\.0\\.1|\\[::1\\]):[0-9]+',
	'\\blistening (on|at)\\b',
	'\\bready in [0-9]+',
	'\\bstartup complete\\b',
]

export const DEFAULT_READY_PATTERNS: RegExp[] =
	DEFAULT_READY_PATTERN_SOURCES.map(source => new RegExp(source, 'i'))

export function compileReadyPattern(source: string): RegExp {
	try {
		return new RegExp(source)
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error)
		throw new Error(`Invalid readyPattern "${source}": ${reason}`, {
			cause: error,
		})
	}
}

/** Last bytes of the log, empty string when the file is absent. */
export function readLogTail(logPath: string): string {
	let fd: number
	try {
		fd = openSync(logPath, 'r')
	} catch {
		return ''
	}
	try {
		const { size } = fstatSync(fd)
		const start = Math.max(0, size - LOG_MATCH_WINDOW_BYTES)
		const chunk = Buffer.alloc(size - start)
		readSync(fd, chunk, 0, chunk.length, start)
		return chunk.toString('utf8')
	} finally {
		closeSync(fd)
	}
}

/** Last non-empty lines of the log, bounded in characters. */
export function tailLines(logText: string): string {
	const lines = logText.split('\n').filter(line => line.trim() !== '')
	const tail = lines.slice(-TAIL_LINE_COUNT).join('\n')
	return tail.length > TAIL_MAX_CHARS
		? `…${tail.slice(-TAIL_MAX_CHARS)}`
		: tail
}

export function isLogReady(
	logText: string,
	patterns: readonly RegExp[],
): boolean {
	return patterns.some(pattern => pattern.test(logText))
}

/** First bound localhost URL the server printed, when any. */
export function extractUrl(logText: string): string | undefined {
	const match =
		/https?:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+(\/[^\s"']*)?/.exec(
			logText,
		)
	return match?.[0]
}

/** Whether anything accepts TCP connections on the port right now. */
export function isPortServing(port: number): Promise<boolean> {
	return new Promise(resolve => {
		const socket = createConnection({ port, host: '127.0.0.1' })
		socket.setTimeout(PORT_PROBE_TIMEOUT_MS)
		const settle = (isServing: boolean): void => {
			socket.destroy()
			resolve(isServing)
		}
		socket.once('connect', () => settle(true))
		socket.once('error', () => settle(false))
		socket.once('timeout', () => settle(false))
	})
}

/** Whether the health URL answers with a 2xx right now. */
export async function isHealthOk(url: string): Promise<boolean> {
	try {
		const response = await fetch(url, {
			signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
		})
		return response.ok
	} catch {
		return false
	}
}
