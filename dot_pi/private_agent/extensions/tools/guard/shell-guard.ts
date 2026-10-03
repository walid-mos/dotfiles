// Own bash's file-lookup policy; execution and read history stay outside.
import {
	isDirectorySetup,
	isOutputFilter,
	shellStages,
} from './shell-segments.ts'

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
const SED_PROGRAM_ARGS = 2
const SUMMARY_FLAG = /^(?:-c|-l|--count|--count-matches|--files-with-matches)$/
const SHELL_ONLY = new Map([
	['cat', /^-$/],
	['grep', SUMMARY_FLAG],
	['rg', SUMMARY_FLAG],
	['find', /^-(?:exec|execdir|delete|ok|okdir)$/],
])

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
			/^\d+(?:,\d+|,\$)?p$/.test(args[1] ?? '') &&
			args.length > SED_PROGRAM_ARGS &&
			args.slice(SED_PROGRAM_ARGS).every(arg => !arg.startsWith('-'))
		)
	)
		return undefined
	return OWNERS.get(name)
}

function ownerOf(
	command: string,
	activeTools: readonly string[],
): string | undefined {
	const stages = shellStages(command)
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

export function shellLookupRefusal(
	input: unknown,
	activeTools: readonly string[],
): { block: true; reason: string } | undefined {
	const owner = ownerOf(commandOf(input), activeTools)
	if (!owner) return undefined
	return {
		block: true,
		reason: `Use the active ${owner} tool for this file lookup. Use bash for commands that transform or store results.`,
	}
}
