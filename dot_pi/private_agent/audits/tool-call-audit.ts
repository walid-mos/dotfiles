// Re-runnable tool-call audit over the Pi session log.
//
//   node audits/tool-call-audit.ts [--days N]
//
// Reports: (1) wall-clock burned on host-level `sleep` waits and the guard's verdict,
// (2) bash calls whose work a dedicated tool owns, (3) calls holding a turn 60s or more,
// (4) use of the real waiting primitives (`bg_wait`, async subagents).
//
// See audits/README.md, and the baseline reports beside this file.

import { scanSessions, sinceFromArgs } from './scan.ts'

import type { Call } from './scan.ts'

/** Waits below the guard's threshold still count here. */
const REPORT_WAIT_SECONDS = 5
/** A call holding the turn this long is worth looking at. */
const BLOCKING_SECONDS = 60
const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60

/** Column widths and row caps for the printed report. */
const WAIT_COLUMN = 5
const TIMESTAMP_CHARS = 19
const COMMAND_CHARS = 110
const TOP_ROWS = 10

function out(line = ''): void {
	process.stdout.write(`${line}\n`)
}

/** `timestamp  command` on one line, trimmed to a readable width. */
function describe(call: Call): string {
	const label = (call.command || call.tool).replace(/\s+/g, ' ')
	return `${call.at.slice(0, TIMESTAMP_CHARS)} ${label.slice(0, COMMAND_CHARS)}`
}

function printWaits(calls: Call[]): void {
	const waits = calls
		.filter(call => call.waitSeconds >= REPORT_WAIT_SECONDS)
		.toSorted((a, b) => b.waitSeconds - a.waitSeconds)
	const minutes =
		waits.reduce((total, call) => total + call.waitSeconds, 0) /
		SECONDS_PER_MINUTE
	const blocked = waits.filter(call => call.requestedWait).length
	out('\n== 1. host-level blind waits ==')
	out(
		`calls: ${waits.length} | wall-clock: ${minutes.toFixed(0)} min | the guard blocks: ${blocked}`,
	)
	for (const call of waits.slice(0, TOP_ROWS)) {
		out(
			`  [${Math.round(call.waitSeconds).toString().padStart(WAIT_COLUMN)}s] ${describe(call)}`,
		)
	}
}

function printShadowed(calls: Call[]): void {
	const byCommand = new Map<string, number>()
	let blockedSegments = 0
	for (const call of calls) {
		for (const { name, tool } of call.shadowed) {
			blockedSegments++
			const key = `${name} -> ${tool}`
			byCommand.set(key, (byCommand.get(key) ?? 0) + 1)
		}
	}
	const blockedCalls = calls.filter(call => call.shadowed.length > 0).length
	const rows = [...byCommand]
		.toSorted((a, b) => b[1] - a[1])
		.slice(0, TOP_ROWS)
		.map(([key, count]) => `${key}: ${count}`)
	out('\n== 2. bash work a dedicated tool owns ==')
	out(
		`calls: ${blockedCalls} | segments the guard blocks: ${blockedSegments}`,
	)
	out(`by command: ${rows.join(', ')}`)
}

function printBlocking(calls: Call[]): void {
	const floor = BLOCKING_SECONDS * MS_PER_SECOND
	const interrupted = calls.filter(call => call.wasAborted).length
	const blocking = calls
		.filter(call => !call.wasAborted && call.durationMs >= floor)
		.toSorted((a, b) => b.durationMs - a.durationMs)
	out(`\n== 3. tool calls holding the turn >= ${BLOCKING_SECONDS}s ==`)
	out(
		`calls: ${blocking.length} | interrupted, so not slow work: ${interrupted}`,
	)
	for (const call of blocking.slice(0, TOP_ROWS)) {
		const seconds = Math.round(call.durationMs / MS_PER_SECOND)
			.toString()
			.padStart(WAIT_COLUMN)
		out(`  [${seconds}s] ${describe(call)}`)
	}
}

function printPrimitives(scan: ReturnType<typeof scanSessions>): void {
	const spent = Math.round(
		scan.calls.reduce((total, call) => total + call.waitSeconds, 0),
	)
	out('\n== 4. waiting primitives ==')
	out(
		`bg_wait: ${scan.toolUse.get('bg_wait') ?? 0} | subagent: ${scan.toolUse.get('subagent') ?? 0} | blind wait total: ${spent}s`,
	)
}

function main(): void {
	const scan = scanSessions(sinceFromArgs(process.argv))
	const days = process.argv.indexOf('--days')
	out(
		`files: ${scan.files} | command calls: ${scan.calls.length} | sessions: ${scan.sessions.size}`,
	)
	if (days !== -1) out(`window: last ${process.argv[days + 1] ?? 0} days`)
	printWaits(scan.calls)
	printShadowed(scan.calls)
	printBlocking(scan.calls)
	printPrimitives(scan)
}

main()
