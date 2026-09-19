// tool-guard rule 1: a host-level wait that buys nothing.
//
// A `sleep` of ten seconds or more is a blind wait. A fixed delay is a race,
// not a synchronization: 195 such calls had burned 192 minutes of wall-clock
// across seven sessions. What the call wants is a signal - a detached command
// whose log is read later, an async subagent, `bg_wait`, or a bounded
// readiness check on the port, pid or file the work produces.
//
// Only commands the host shell actually runs are judged, so a `sleep` planted
// inside a container call (`container exec ... sh -c 'sleep 30'`) or inside a
// test fixture stays legal. shell-text.ts owns the parsing.

import { leadingCommand, parseShellText, segments } from './shell-text.ts'

/** Host-level waits at or above this many seconds are blocked. */
export const MAX_WAIT_SECONDS = 10

const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 3600

/**
 * The reason to show the model when a call would blind-wait, or undefined when
 * every `sleep` it runs is short enough to be a poll rather than a wait.
 */
export function blindWaitReason(command: string): string | undefined {
	for (const segment of segments(parseShellText(command))) {
		const { name, args } = leadingCommand(segment)
		if (name !== 'sleep') continue
		const seconds = sleepSeconds(args[0] ?? '')
		if (seconds === null || seconds < MAX_WAIT_SECONDS) continue
		return [
			`tool-guard blocked \`${segment.trim()}\`: a blind wait of ${seconds}s is a race, not a synchronization.`,
			'Detach the work (`setsid nohup <cmd> > /tmp/<name>.log 2>&1 &`) and end the turn, then read the log; for an event, wait on the async subagent, `bg_wait`, or a bounded readiness check (port/pid/file).',
			'`sleep` is only legal as a container keep-alive or a planted test-fixture delay. Rule: AGENTS.md # Tool calls.',
		].join(' ')
	}
	return undefined
}

/** Seconds of a `sleep` argument, with its optional unit. */
function sleepSeconds(argument: string): number | null {
	const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(argument)
	if (!match) return null
	const [, digits, unit] = match
	const amount = Number.parseFloat(digits ?? '')
	switch (unit) {
		case 'ms':
			return amount / MS_PER_SECOND
		case 'm':
			return amount * SECONDS_PER_MINUTE
		case 'h':
			return amount * SECONDS_PER_HOUR
		default:
			return amount
	}
}
