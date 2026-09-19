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
import {
	hasSummaryFlag,
	isGrepCommand,
	isTempPath,
	grepPaths,
	readerPaths,
} from './stage-arguments.ts'
import { suggestedCall } from './suggested-call.ts'

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
		const { name, args } = leadingCommand(judged.stage)
		return [
			`tool-guard blocked \`${judged.stage.trim()}\`: use the \`${verdict.tool}\` tool${suggestedCall(verdict.tool, name, args)}.`,
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
	return segments(parseShellText(command)).flatMap(judgedInSegment)
}

/** Every shadowed stage of one segment: a pipeline hands the text along. */
function judgedInSegment(segment: string): Judged[] {
	const stages = pipeStages(segment)
	return stages.flatMap((stage, index) => {
		const verdict = stageVerdict(stage, stages.slice(index + 1))
		return verdict.kind === 'plain'
			? []
			: [{ stage, name: verdict.name, verdict }]
	})
}

/** The verdict on one pipeline stage: refused, exempt, or not shadowed at all. */
function stageVerdict(stage: string, downstream: readonly string[]): Verdict {
	const { name, args } = leadingCommand(stage)
	const tool = SHADOWED_COMMANDS.get(name)
	if (!tool) return PLAIN
	if (isGrepCommand(name)) {
		if (hasSummaryFlag(args))
			return { kind: 'exempt', name, reason: 'grep summary flag' }
		if (grepPaths(args).every(isTempPath))
			return { kind: 'exempt', name, reason: 'grep over a /tmp log' }
	}
	if (
		name === 'find' &&
		FIND_MUTATING_FLAGS.some(flag => args.includes(flag))
	)
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
