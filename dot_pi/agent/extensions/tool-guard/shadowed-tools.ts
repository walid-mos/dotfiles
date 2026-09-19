// tool-guard rule 2: a bash stage whose work a dedicated tool owns.
//
// A stage is refused wherever it sits and whatever surrounds it: a pipe, a
// redirect (`2>/dev/null` included) or a `head`/`tail` wrapper changes neither
// what the call is nor where its text lands. Tool results are capped, rendered
// and cached; raw text is re-billed on every later turn.
//
// Form is not intent, so the exemptions name work no tool can do rather than
// punctuation: derived output (counts, `jq`/`awk`/`sed` scripts, metadata),
// mutations (`find -exec`, `xargs`), a reader whose operands are throwaway logs
// under /tmp, and a reader feeding a count or the clipboard. Those look-alike
// tools stay legal on purpose - `sed`, `awk`, `jq`, `wc`, `stat`, `file`, `du`
// derive one view of a file, they do not hand over the file the `read` tool
// owns, and refusing them would push the model to read whole files instead.
//
// One verdict function owns both directions: what is refused, and the exempt
// form a call fell under when it was not. The audit reads the second one, so
// its escape vocabulary cannot drift from the exemptions.

import {
	leadingCommand,
	parseShellText,
	pipeStages,
	segments,
} from './shell-text.ts'

/**
 * bash command name -> the dedicated tool that owns its work. The audit reads
 * this map too, so the counts it reports cannot drift from what the guard does.
 */
export const SHADOWED_COMMANDS = new Map([
	['cat', 'read'],
	['head', 'read'],
	['tail', 'read'],
	['nl', 'read'],
	['tac', 'read'],
	['bat', 'read'],
	['less', 'read'],
	['more', 'read'],
	['grep', 'grep'],
	['egrep', 'grep'],
	['fgrep', 'grep'],
	['rg', 'grep'],
	['find', 'find'],
	['tree', 'find'],
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

/** Reader flags that consume the next word: a count, never a path. */
const READER_VALUE_FLAGS = new Set(['-n', '-c', '--lines', '--bytes'])

/** find flags that do real work rather than list matches. */
const FIND_MUTATING_FLAGS = ['-exec', '-execdir', '-delete', '-ok', '-okdir']

/** Pipeline stages whose output is a count or the clipboard, never the text. */
const SINK_COMMANDS = new Set(['wc', 'pbcopy'])

/** Pipeline stages that consume a reader's output by moving or changing it. */
const MUTATOR_COMMANDS = new Set([
	'xargs',
	'rm',
	'mv',
	'cp',
	'chmod',
	'chown',
	'install',
])

/** Paths the agent writes throwaway logs to; text there is not project content. */
const TEMP_PATH_PREFIXES = ['/tmp/', '/private/tmp/', '/var/folders/']

/**
 * Every `{ name, tool }` pair a command would be blocked for, in segment order.
 * The audit uses this so it counts exactly what the guard blocks.
 */
export function shadowedCommands(
	command: string,
): { name: string; tool: string }[] {
	return judgedStages(command).flatMap(judged =>
		judged.verdict.kind === 'owned'
			? [{ name: judged.name, tool: judged.verdict.tool }]
			: [],
	)
}

/**
 * Why a command whose work a dedicated tool owns was allowed through anyway:
 * the exempt form its first shadowed stage fell under, or undefined when no
 * stage of it is shadowed at all.
 */
export function exemptionReason(command: string): string | undefined {
	for (const judged of judgedStages(command)) {
		if (judged.verdict.kind === 'exempt') return judged.verdict.reason
	}
	return undefined
}

/**
 * The reason to show the model when a command does work a dedicated tool owns,
 * or undefined when every stage of it stays legal.
 */
export function shadowedToolReason(
	command: string,
	activeTools: readonly string[] = [...SHADOWED_COMMANDS.values()],
): string | undefined {
	for (const judged of judgedStages(command)) {
		const { verdict } = judged
		if (verdict.kind !== 'owned' || !activeTools.includes(verdict.tool))
			continue
		return [
			`tool-guard blocked \`${judged.stage.trim()}\`: use the \`${verdict.tool}\` tool${suggestedCall(judged)}.`,
			'It caps, renders and caches its output; a pipe, a redirect or a `head`/`tail` wrapper does not change what the call is.',
		].join(' ')
	}
	return undefined
}

/** A pipeline stage, and what the guard has to say about it. */
type Judged = { stage: string; name: string; verdict: Verdict }

type Verdict =
	| { kind: 'owned'; name: string; tool: string }
	| { kind: 'exempt'; name: string; reason: string }
	| { kind: 'plain' }

const PLAIN: Verdict = { kind: 'plain' }

/** Every shadowed stage of a command, with the guard's verdict on it, in order. */
function judgedStages(command: string): Judged[] {
	const judged: Judged[] = []
	for (const segment of segments(parseShellText(command))) {
		const stages = pipeStages(segment)
		for (let index = 0; index < stages.length; index++) {
			const stage = stages[index] ?? ''
			const verdict = stageVerdict(stage, stages.slice(index + 1))
			if (verdict.kind !== 'plain') judged.push({ stage, name: verdict.name, verdict })
		}
	}
	return judged
}

/** The verdict on one pipeline stage: refused, exempt, or not shadowed at all. */
function stageVerdict(
	stage: string,
	downstream: readonly string[],
): Verdict {
	const { name, args } = leadingCommand(stage)
	const tool = SHADOWED_COMMANDS.get(name)
	if (!tool) return PLAIN
	if (isGrepCommand(name)) {
		if (hasSummaryFlag(args))
			return { kind: 'exempt', name, reason: 'grep summary flag' }
		if (grepPaths(args).every(isTempPath))
			return { kind: 'exempt', name, reason: 'grep over a /tmp log' }
	}
	if (name === 'find' && FIND_MUTATING_FLAGS.some(flag => args.includes(flag)))
		return { kind: 'exempt', name, reason: 'find mutation' }
	if (isReaderCommand(name)) {
		const paths = readerPaths(args)
		if (!paths.length)
			return { kind: 'exempt', name, reason: 'reader of piped input' }
		if (paths.every(isTempPath))
			return {
				kind: 'exempt',
				name,
				reason: 'reader of throwaway logs under /tmp',
			}
	}
	if (downstreamIsSink(downstream))
		return {
			kind: 'exempt',
			name,
			reason: 'piped into a count or the clipboard',
		}
	if (downstreamIsMutator(downstream))
		return { kind: 'exempt', name, reason: 'piped into a mutating stage' }
	return { kind: 'owned', name, tool }
}

/** True when every stage after this one is a count or the clipboard. */
function downstreamIsSink(downstream: readonly string[]): boolean {
	return downstream.length > 0 && downstream.every(isSinkStage)
}

/** True when a stage produces a count, a file list or nothing but silence. */
function isSinkStage(stage: string): boolean {
	const { name, args } = leadingCommand(stage)
	if (SINK_COMMANDS.has(name)) return true
	return isGrepCommand(name) && hasSummaryFlag(args)
}

/** True when a later stage consumes the text by moving or changing it. */
function downstreamIsMutator(downstream: readonly string[]): boolean {
	return downstream.some(stage =>
		MUTATOR_COMMANDS.has(leadingCommand(stage).name),
	)
}

/** Readers whose whole job is to hand over a file's text. */
function isReaderCommand(name: string): boolean {
	return SHADOWED_COMMANDS.get(name) === 'read'
}

function isGrepCommand(name: string): boolean {
	return (
		name === 'grep' ||
		name === 'egrep' ||
		name === 'fgrep' ||
		name === 'rg' ||
		name === 'ag' ||
		name === 'ack'
	)
}

/** Count / file-list / quiet flags, including short clusters like `-cE`. */
function hasSummaryFlag(args: string[]): boolean {
	return args.some(arg => {
		if (!arg.startsWith('--')) return /^-[A-Za-z]*[clq][A-Za-z]*$/.test(arg)
		const [name] = arg.split('=')
		return GREP_SUMMARY_FLAGS.has(name ?? arg)
	})
}

/** The paths of a grep-style command, ignoring flags and the pattern. */
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

/** The pattern operand of a grep-style command, when it names one outright. */
function grepPattern(args: string[]): string | undefined {
	const flagIndex = args.findIndex(arg => arg === '-e' || arg === '--regexp')
	if (flagIndex >= 0) return args[flagIndex + 1]
	return args.find(arg => !arg.startsWith('-'))
}

/** The files a reader is handed, whatever count flags surround them. */
function readerPaths(args: string[]): string[] {
	const paths: string[] = []
	for (let index = 0; index < args.length; index++) {
		const arg = args[index]
		if (arg === undefined) continue
		const flag = arg.startsWith('-')
		const takesValue =
			!arg.includes('=') && READER_VALUE_FLAGS.has(arg.split('=')[0] ?? arg)
		if (flag && takesValue) index++
		if (flag) continue
		paths.push(arg)
	}
	return paths
}

/** The line count of a `head` call: `-n 40`, `-40`, or nothing. */
function headLimit(args: string[]): string | undefined {
	const nameIndex = args.indexOf('-n')
	if (nameIndex >= 0 && /^\d+$/.test(args[nameIndex + 1] ?? ''))
		return args[nameIndex + 1]
	return args.find(arg => /^-\d+$/.test(arg))?.slice(1)
}

function isTempPath(path: string): boolean {
	return TEMP_PATH_PREFIXES.some(prefix => path.startsWith(prefix))
}

/**
 * The call the dedicated tool would take, read off the shadower's own operands:
 * what the model needs at the moment it retries, instead of a catalogue of the
 * bash forms that stay legal.
 */
function suggestedCall(judged: Judged): string {
	if (judged.verdict.kind !== 'owned') return ''
	const { name, args } = leadingCommand(judged.stage)
	const hints = argumentHints(judged.verdict.tool, name, args)
	return hints.length ? ` (${hints.join(', ')})` : ''
}

/** Tool arguments the shadowed stage already carries: path, pattern, limit. */
function argumentHints(tool: string, name: string, args: string[]): string[] {
	if (tool === 'grep') {
		const pattern = grepPattern(args)
		const [path] = grepPaths(args)
		return [
			...(pattern ? [`pattern: \`${pattern}\``] : []),
			...(path ? [`path: \`${path}\``] : []),
		]
	}
	if (tool === 'find') return findHints(name, args)
	const [path] = readerPaths(args)
	const limit = name === 'head' ? headLimit(args) : undefined
	return [
		...(path ? [`path: \`${path}\``] : []),
		...(limit ? [`limit: ${limit}`] : []),
	]
}

/** Where a `find` or `tree` call pointed: the path, and the name it matched. */
function findHints(name: string, args: string[]): string[] {
	if (name === 'tree') {
		const [path] = readerPaths(args)
		return path ? [`path: \`${path}\``] : []
	}
	const path = args.find(arg => !arg.startsWith('-'))
	const nameIndex = args.findIndex(arg => arg === '-name' || arg === '-iname')
	const pattern = nameIndex >= 0 ? args[nameIndex + 1] : undefined
	return [
		...(path ? [`path: \`${path}\``] : []),
		...(pattern ? [`pattern: \`${pattern}\``] : []),
	]
}
