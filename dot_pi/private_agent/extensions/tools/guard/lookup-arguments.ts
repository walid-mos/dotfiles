/**
 * The 1:1 translations of a lookup-only shell stage into its owning tool's
 * arguments: cat/head/sed -n → read, grep/rg → grep, find -name → find,
 * ls → ls. Undefined means the shape has no exact tool equivalent. Pure.
 */
import { resolve } from 'node:path'

import type { ShellStage } from './shell-segments.ts'

export const SED_PROGRAM_ARGS = 2
export const SED_RANGE = /^(\d+)(?:,(\d+|\$))?p$/
const DEFAULT_HEAD_LINES = 10
const HEAD_FLAG_WORDS = 2
const MAX_GREP_OPERANDS = 2
const FIND_TYPE_WORDS = 2
const LS_FLAGS = /^-[la1]+$/
const GREP_FLAGS = /^-[EFinr]+$/
const GREP_INCLUDE = /^--include=(.+)$/

export type ToolArguments = Record<string, unknown>

/** One lookup stage, the optional `| head` line cap, and the directory paths resolve against. */
export interface SimpleLookup {
	stage: ShellStage
	headLines: number | undefined
	base: string
}

type Resolver = (path: string | undefined) => string

/** `head`, `head -n N`, `head -N`: the line count; byte heads are not a read range. */
export function headCount(words: readonly string[]): number | undefined {
	const [, ...args] = words
	if (!args.length) return DEFAULT_HEAD_LINES
	if (args.length === 1 && /^-\d+$/.test(args[0] ?? ''))
		return Number(args[0]?.slice(1))
	if (
		args.length === HEAD_FLAG_WORDS &&
		args[0] === '-n' &&
		/^\d+$/.test(args[1] ?? '')
	)
		return Number(args[1])
	return undefined
}

function limitOf(lines: number | undefined): { limit: number } | undefined {
	if (!lines) return undefined
	return { limit: lines }
}

function globOf(include: string | undefined): { glob: string } | undefined {
	if (!include) return undefined
	return { glob: include }
}

function flagOf(
	flags: string,
	letter: string,
	key: string,
): Record<string, true> | undefined {
	if (!flags.includes(letter)) return undefined
	return { [key]: true }
}

function split(args: readonly string[]): {
	flags: string[]
	operands: string[]
} {
	return {
		flags: args.filter(arg => arg.startsWith('-')),
		operands: args.filter(arg => !arg.startsWith('-')),
	}
}

function sedArguments(
	args: readonly string[],
	at: Resolver,
): ToolArguments | undefined {
	const range = SED_RANGE.exec(args[1] ?? '')
	if (!range || args.length !== SED_PROGRAM_ARGS + 1) return undefined
	const [, from, to] = range
	const path = at(args[SED_PROGRAM_ARGS])
	const offset = Number(from)
	if (!to) return { path, offset, limit: 1 }
	if (to === '$') return { path, offset }
	return { path, offset, limit: Math.max(1, Number(to) - offset + 1) }
}

function readArguments(
	words: readonly string[],
	headLines: number | undefined,
	at: Resolver,
): ToolArguments | undefined {
	const [name, ...args] = words
	const { flags, operands } = split(args)
	if (name === 'cat') {
		if (operands.length !== 1 || flags.some(flag => flag !== '-n'))
			return undefined
		return { path: at(operands[0]), ...limitOf(headLines) }
	}
	if (name === 'head') {
		const file = args.at(-1)
		if (!file || file.startsWith('-')) return undefined
		const lines = headCount(['head', ...args.slice(0, -1)])
		if (!lines) return undefined
		return { path: at(file), limit: Math.min(lines, headLines ?? lines) }
	}
	if (name === 'sed') return sedArguments(args, at)
	return undefined
}

function grepArguments(
	args: readonly string[],
	headLines: number | undefined,
	at: Resolver,
): ToolArguments | undefined {
	const { flags, operands } = split(args)
	const includes = flags.flatMap(flag => {
		const match = GREP_INCLUDE.exec(flag)
		return match?.[1] ? [match[1]] : []
	})
	const plain = flags.filter(flag => !GREP_INCLUDE.test(flag))
	if (plain.some(flag => !GREP_FLAGS.test(flag))) return undefined
	if (!operands.length || operands.length > MAX_GREP_OPERANDS)
		return undefined
	if (includes.length > 1) return undefined
	const joined = plain.join('')
	return {
		pattern: operands[0],
		path: at(operands[1]),
		...globOf(includes[0]),
		...flagOf(joined, 'i', 'ignoreCase'),
		...flagOf(joined, 'F', 'literal'),
		...limitOf(headLines),
	}
}

function findArguments(
	args: readonly string[],
	headLines: number | undefined,
	at: Resolver,
): ToolArguments | undefined {
	const [root, predicate, pattern, ...rest] = args
	if (!root || root.startsWith('-') || !pattern) return undefined
	if (predicate !== '-name' && predicate !== '-iname') return undefined
	if (
		rest.length &&
		!(rest.length === FIND_TYPE_WORDS && rest[0] === '-type')
	)
		return undefined
	return { pattern: `**/${pattern}`, path: at(root), ...limitOf(headLines) }
}

function lsArguments(
	args: readonly string[],
	headLines: number | undefined,
	at: Resolver,
): ToolArguments | undefined {
	const { flags, operands } = split(args)
	if (operands.length > 1 || flags.some(flag => !LS_FLAGS.test(flag)))
		return undefined
	return { path: at(operands[0]), ...limitOf(headLines) }
}

/** The owning tool's arguments for one lookup stage, or undefined when the shape is not 1:1. */
export function redirectArguments(
	simple: SimpleLookup,
	owner: string,
): ToolArguments | undefined {
	const [name, ...args] = simple.stage.words
	const at: Resolver = path => resolve(simple.base, path ?? '.')
	if (owner === 'read')
		return readArguments(simple.stage.words, simple.headLines, at)
	if (owner === 'grep') return grepArguments(args, simple.headLines, at)
	if (owner === 'find') return findArguments(args, simple.headLines, at)
	if (owner === 'ls' && name === 'ls')
		return lsArguments(args, simple.headLines, at)
	return undefined
}
