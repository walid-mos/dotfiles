// tool-guard policy: pure rules over a shell command string, no TUI, no pi.
//
// Two rules, both paid for by the session logs:
//  1. A host-level `sleep` of ten seconds or more is a blind wait. A fixed
//     delay is a race, not a synchronization: 195 such calls had burned 192
//     minutes of wall-clock across seven sessions.
//  2. A bash command whose work a dedicated tool owns (`cat`, `grep`, `rg`,
//     `find`, `ls`) dumps into the context unbounded, where the tool result is
//     capped, rendered and re-read from cache on every later turn.
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

/** bash command name -> the dedicated tool that owns its work. */
const SHADOWED_COMMANDS = new Map([
	['cat', 'read'],
	['grep', 'grep'],
	['egrep', 'grep'],
	['fgrep', 'grep'],
	['rg', 'grep'],
	['find', 'find'],
	['ls', 'ls'],
])

/** grep flags whose output no dedicated tool can produce (counts, file lists). */
const GREP_SUMMARY_FLAGS = new Set([
	'-c',
	'--count',
	'-l',
	'--files-with-matches',
	'--files-without-match',
	'-q',
	'--quiet',
	'--silent',
])

/** grep flags that consume the next word (pattern or file list). */
const GREP_VALUE_FLAGS = new Set([
	'-e',
	'--regexp',
	'-f',
	'--file',
	'-m',
	'--max-count',
	'--include',
	'--exclude',
	'--include-dir',
	'--exclude-dir',
])

/** find flags that do real work rather than list matches. */
const FIND_MUTATING_FLAGS = ['-exec', '-execdir', '-delete', '-ok', '-okdir']

/** Paths the agent writes throwaway logs to; text there is not project content. */
const TEMP_PATH_PREFIXES = ['/tmp/', '/private/tmp/', '/var/folders/']

/**
 * Rule 1: a host-level `sleep` that makes the call wait instead of reacting.
 * Returns the reason to show the model, or undefined when the command is fine.
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

/**
 * Every `{ name, tool }` pair a command would be blocked for, in segment order.
 * The audit uses this so it counts exactly what the guard blocks.
 */
export function shadowedCommands(
	command: string,
): { name: string; tool: string }[] {
	const found: { name: string; tool: string }[] = []
	for (const segment of segments(parseShellText(command))) {
		const shadowed = shadowedInSegment(segment)
		if (shadowed) found.push(shadowed)
	}
	return found
}

/**
 * Rule 2: a bash command whose work a dedicated tool already owns.
 * Pipeline stages and redirected output stay legal - those transform or store
 * data, which the tools do not do.
 */
export function shadowedToolReason(
	command: string,
	activeTools: readonly string[] = [...SHADOWED_COMMANDS.values()],
): string | undefined {
	for (const segment of segments(parseShellText(command))) {
		const shadowed = shadowedInSegment(segment)
		if (!shadowed || !activeTools.includes(shadowed.tool)) continue
		return [
			`tool-guard blocked \`${segment.trim()}\`: use the \`${shadowed.tool}\` tool instead of bash \`${shadowed.name}\`.`,
			`The tool result is capped and rendered; a raw \`${shadowed.name}\` dumps into the context and is re-billed on every later turn.`,
			'Bash stays right for pipelines (`|`), redirected output (`>`), counts (`grep -c`), mutations (`find -exec`) and `grep` over throwaway logs under /tmp.',
		].join(' ')
	}
	return undefined
}

/** The shadowed command of one segment, when the call should be blocked. */
function shadowedInSegment(
	segment: string,
): { name: string; tool: string } | undefined {
	if (/[|<>]/.test(segment)) return undefined
	const { name, args } = leadingCommand(segment)
	const tool = SHADOWED_COMMANDS.get(name)
	if (!tool) return undefined
	if (isGrepCommand(name) && grepIsAllowed(args)) return undefined
	if (
		name === 'find' &&
		FIND_MUTATING_FLAGS.some(flag => args.includes(flag))
	)
		return undefined
	return { name, tool }
}

function isGrepCommand(name: string): boolean {
	return (
		name === 'grep' || name === 'egrep' || name === 'fgrep' || name === 'rg'
	)
}

/** Grep the dedicated tool cannot replace: summaries, and throwaway logs. */
function grepIsAllowed(args: string[]): boolean {
	if (hasSummaryFlag(args)) return true
	return grepPaths(args).every(isTempPath)
}

/** Count / file-list / quiet flags, including short clusters like `-cE`. */
function hasSummaryFlag(args: string[]): boolean {
	return args.some(arg => {
		if (!arg.startsWith('--')) return /^-[A-Za-z]*[clq][A-Za-z]*$/.test(arg)
		const [name] = arg.split('=')
		return GREP_SUMMARY_FLAGS.has(name ?? arg)
	})
}

/** Search paths of a grep-style command, ignoring flags and the pattern. */
function grepPaths(args: string[]): string[] {
	const patternIsFlag = args.some(
		arg =>
			arg === '-e' ||
			arg === '--regexp' ||
			arg === '-f' ||
			arg === '--file',
	)
	const paths: string[] = []
	let patternSeen = patternIsFlag
	for (let index = 0; index < args.length; index++) {
		const arg = args[index]
		if (arg === undefined) continue
		const flag = arg.startsWith('-')
		const takesValue =
			!arg.includes('=') && GREP_VALUE_FLAGS.has(arg.split('=')[0] ?? arg)
		if (flag && takesValue) index++
		if (flag) continue
		if (!patternSeen) {
			patternSeen = true
			continue
		}
		paths.push(arg)
	}
	return paths
}

function isTempPath(path: string): boolean {
	return TEMP_PATH_PREFIXES.some(prefix => path.startsWith(prefix))
}

/** The full policy: the first rule that fires wins. */
export function guardCommand(
	command: string,
	activeTools: readonly string[] = [...SHADOWED_COMMANDS.values()],
): string | undefined {
	return blindWaitReason(command) ?? shadowedToolReason(command, activeTools)
}
