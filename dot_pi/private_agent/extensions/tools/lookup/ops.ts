/** lookup, pure: the operation schema and the one result text several nested lookups become. */
import { Type } from 'typebox'

import type { Static } from 'typebox'

/** Per-operation and whole-result caps; the model narrows with offset/limit/glob. */
export const OP_CHARS = 12_000
export const RESULT_CHARS = 48_000
export const MAX_OPS = 12

export const LOOKUP_TOOLS = ['read', 'grep', 'find', 'ls'] as const
export type LookupTool = (typeof LOOKUP_TOOLS)[number]

const operation = Type.Object(
	{
		tool: Type.Union(
			[
				Type.Literal('read'),
				Type.Literal('grep'),
				Type.Literal('find'),
				Type.Literal('ls'),
			],
			{ description: 'Which lookup to run.' },
		),
		path: Type.Optional(
			Type.String({
				description:
					'read: the file. grep/find/ls: the directory (default: cwd).',
			}),
		),
		pattern: Type.Optional(
			Type.String({
				description:
					'grep: regex to match. find: glob of file names, e.g. "**/*.test.ts".',
			}),
		),
		offset: Type.Optional(
			Type.Integer({
				minimum: 1,
				description: 'read: first line (1-based).',
			}),
		),
		limit: Type.Optional(
			Type.Integer({
				minimum: 1,
				description: 'read: line count. grep/find/ls: max results.',
			}),
		),
		glob: Type.Optional(
			Type.String({
				description: 'grep: restrict to files matching this glob.',
			}),
		),
		ignoreCase: Type.Optional(Type.Boolean({ description: 'grep only.' })),
		literal: Type.Optional(
			Type.Boolean({ description: 'grep: match the pattern literally.' }),
		),
		context: Type.Optional(
			Type.Integer({
				minimum: 0,
				description: 'grep: lines of context around each match.',
			}),
		),
	},
	{ additionalProperties: false },
)
export type LookupOperation = Static<typeof operation>

export const lookupParameters = Type.Object(
	{
		ops: Type.Array(operation, {
			minItems: 1,
			maxItems: MAX_OPS,
			description:
				'Independent lookups to run together, in order. Results come back labelled by index.',
		}),
	},
	{ additionalProperties: false },
)
export type LookupParameters = Static<typeof lookupParameters>

type OperationField = Exclude<keyof LookupOperation, 'tool'>
const OWNED_FIELDS: Record<LookupTool, readonly OperationField[]> = {
	read: ['path', 'offset', 'limit'],
	grep: [
		'pattern',
		'path',
		'glob',
		'ignoreCase',
		'literal',
		'context',
		'limit',
	],
	find: ['pattern', 'path', 'limit'],
	ls: ['path', 'limit'],
}

/** The arguments the owning tool receives: its own fields only, absent ones left absent. */
export function toolArguments(op: LookupOperation): Record<string, unknown> {
	const entries: [string, unknown][] = []
	for (const key of OWNED_FIELDS[op.tool]) {
		if (Object.hasOwn(op, key)) entries.push([key, op[key]])
	}
	return Object.fromEntries(entries)
}

function readRange(op: LookupOperation): string {
	if (!op.offset && !op.limit) return ''
	const first = op.offset ?? 1
	if (!op.limit) return ` ${first}-`
	return ` ${first}-${first + op.limit - 1}`
}

export function describeOperation(op: LookupOperation): string {
	const target = op.path ?? '.'
	if (op.tool === 'read') return `read ${target}${readRange(op)}`
	if (op.tool === 'ls') return `ls ${target}`
	return `${op.tool} ${JSON.stringify(op.pattern ?? '')} in ${target}`
}

export interface OperationOutcome {
	op: LookupOperation
	text: string
	isError: boolean
}

function clip(text: string, max: number): string {
	if (text.length <= max) return text
	return `${text.slice(0, max)}\n… ${text.length - max} more chars omitted; narrow with offset/limit, glob or a tighter pattern.`
}

/** One labelled section per operation, both caps applied, errors inline. */
export function renderOutcomes(outcomes: readonly OperationOutcome[]): {
	text: string
	isError: boolean
} {
	const sections = outcomes.map(
		(outcome, index) =>
			`## [${index + 1}] ${describeOperation(outcome.op)}${outcome.isError ? ' - error' : ''}\n${clip(outcome.text.trim(), OP_CHARS)}`,
	)
	return {
		text: clip(sections.join('\n\n'), RESULT_CHARS),
		isError:
			outcomes.length > 0 && outcomes.every(outcome => outcome.isError),
	}
}
