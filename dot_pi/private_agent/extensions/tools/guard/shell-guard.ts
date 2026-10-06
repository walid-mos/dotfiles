/**
 * Lookup-only shell stages, planned instead of refused: the simple shapes
 * (`[cd X &&] cat|head|sed -n|ls|grep|rg|find … [| head -n N]`) map 1:1 onto
 * the owning tool's arguments (lookup-arguments.ts) and run there; anything
 * lookup-shaped the mapping cannot express stays a refusal. Pure: no IO, no pi.
 */
import { resolve } from 'node:path'

import {
	headCount,
	redirectArguments,
	SED_PROGRAM_ARGS,
	SED_RANGE,
} from './lookup-arguments.ts'
import {
	isDirectorySetup,
	isOutputFilter,
	shellStages,
} from './shell-segments.ts'

import type { SimpleLookup, ToolArguments } from './lookup-arguments.ts'
import type { ShellStage } from './shell-segments.ts'

const OWNERS = new Map([
	['cat', 'read'],
	['grep', 'grep'],
	['rg', 'grep'],
	['find', 'find'],
	['ls', 'ls'],
	['head', 'read'],
	['tail', 'read'],
	['sed', 'read'],
])
const SUMMARY_FLAG = /^(?:-c|-l|--count|--count-matches|--files-with-matches)$/
const SHELL_ONLY = new Map([
	['cat', /^-$/],
	['grep', SUMMARY_FLAG],
	['rg', SUMMARY_FLAG],
	['find', /^-(?:exec|execdir|delete|ok|okdir)$/],
])
const PIPED_STAGES = 2

export type LookupPlan =
	| { kind: 'redirect'; tool: string; args: ToolArguments; note: string }
	| { kind: 'refuse'; reason: string }

function commandOf(input: unknown): string {
	if (!input || typeof input !== 'object') return ''
	const command = Reflect.get(input, 'command')
	return typeof command === 'string' ? command.trim() : ''
}

function lookupOwner(stage: ShellStage): string | undefined {
	const [name, ...args] = stage.words
	if (!name || args.some(arg => SHELL_ONLY.get(name)?.test(arg)))
		return undefined
	// Only plain sed range reads: extra options may execute programs or mutate files.
	if (
		name === 'sed' &&
		!(
			args[0] === '-n' &&
			SED_RANGE.test(args[1] ?? '') &&
			args.length > SED_PROGRAM_ARGS &&
			args.slice(SED_PROGRAM_ARGS).every(arg => !arg.startsWith('-'))
		)
	)
		return undefined
	return OWNERS.get(name)
}

function ownerOf(
	stages: readonly ShellStage[],
	activeTools: readonly string[],
): string | undefined {
	let owner: string | undefined
	for (const [index, stage] of stages.entries()) {
		if (isDirectorySetup(stage)) continue
		if (stages[index - 1]?.after === '|' && isOutputFilter(stage)) continue
		const lookup = lookupOwner(stage)
		if (!lookup || !activeTools.includes(lookup)) return undefined
		owner ??= lookup
	}
	return owner
}

/** `[cd X &&] <lookup> [| head …]`: the one lookup stage, or undefined for any other shape. */
function simpleLookup(
	stages: readonly ShellStage[],
	cwd: string,
): SimpleLookup | undefined {
	const [first, ...rest] = stages
	const setup = first && isDirectorySetup(first) ? first.words[1] : undefined
	const body = setup ? rest : stages
	const [stage, filter, ...extra] = body
	if (!stage || extra.length) return undefined
	const base = resolve(cwd, setup ?? '.')
	if (body.length === 1) return { stage, headLines: undefined, base }
	if (body.length !== PIPED_STAGES || stage.after !== '|') return undefined
	if (filter?.words[0] !== 'head') return undefined
	const headLines = headCount(filter.words)
	if (!headLines) return undefined
	return { stage, headLines, base }
}

function refusal(owner: string): string {
	return `Use the active ${owner} tool for this file lookup. Use bash for commands that transform or store results.`
}

/** Decide what bash does with a lookup-only command: run it through the owner, or refuse. */
export function shellLookupPlan(
	input: unknown,
	activeTools: readonly string[],
	cwd: string,
): LookupPlan | undefined {
	const stages = shellStages(commandOf(input))
	const owner = ownerOf(stages, activeTools)
	if (!owner) return undefined
	const simple = simpleLookup(stages, cwd)
	const args = simple && redirectArguments(simple, owner)
	if (!args) return { kind: 'refuse', reason: refusal(owner) }
	return {
		kind: 'redirect',
		tool: owner,
		args,
		note: `Ran through the ${owner} tool as ${JSON.stringify(args)}; call ${owner} directly next time.`,
	}
}

/** The host tool has no in-tool redirect: a lookup there is refused outright. */
export function shellLookupRefusal(
	input: unknown,
	activeTools: readonly string[],
): { block: true; reason: string } | undefined {
	const owner = ownerOf(shellStages(commandOf(input)), activeTools)
	if (!owner) return undefined
	return { block: true, reason: refusal(owner) }
}
