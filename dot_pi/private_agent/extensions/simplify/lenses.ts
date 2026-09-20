/**
 * The analysis contracts: the three lens tasks, the findings schema handed to
 * the children (and reused to validate what they return), the workflow script
 * that fans them out, and the message that asks the parent model to launch it.
 */

import { Type } from 'typebox'

import type { Static } from 'typebox'
import type { Lens, ScopeManifest } from './types.ts'

export const LENSES = ['reuse', 'quality', 'efficiency'] as const

export const SIMPLIFIER_AGENT = 'simplifier'
export const ANALYSIS_PHASE = 'Simplify'
export const MAX_FINDINGS = 40

const JSON_INDENT = 2

const LENS_TASKS: Record<Lens, string> = {
	reuse: [
		'Find code in scope that already exists elsewhere in this repository.',
		'Name the exact existing symbol, file and call site for every duplicate or near-duplicate: a helper, a util, a type, a component, a query that a changed line reimplements or thinly wraps.',
		'Flag a thin wrapper only when inlining it removes a layer with no loss. Never flag an adapter that isolates an unstable dependency, protects a public API, or marks a domain boundary.',
	].join(' '),
	quality: [
		'Find code in scope that is harder to read, test or maintain than the problem needs: redundant state, dead branches, duplication inside or between the changed regions, needless indirection, an abstraction with one caller that adds nothing, a name that hides what the value means.',
		'Every finding must name the concrete cost the code pays, never a style preference.',
	].join(' '),
	efficiency: [
		'Find work in scope that is done more often or more expensively than it needs to be: a value recomputed each iteration, a lookup or query repeated per item, a redundant copy or allocation, a round-trip inside a loop, sequential work that is independent.',
		'Quantify the saving in the benefit: one query instead of N, one pass instead of two.',
	].join(' '),
}

export const FindingSchema = Type.Object(
	{
		file: Type.String({
			description:
				'Repository-relative path, exactly as the scope manifest spells it.',
		}),
		lines: Type.String({
			description:
				'Line range(s) in the current working tree, for example "42-58" or "42, 90-93".',
		}),
		risk: Type.Union(
			[
				Type.Literal('safe'),
				Type.Literal('confirm'),
				Type.Literal('review'),
			],
			{
				description:
					'safe: provably non-behavioral and mechanical (debug remnant, dead code with a no-reference proof). confirm: behavior-preserving but judgmental. review: needs a human.',
			},
		),
		action: Type.Union(
			[
				Type.Literal('delete'),
				Type.Literal('inline'),
				Type.Literal('refactor'),
				Type.Literal('parallelize'),
				Type.Literal('rename'),
			],
			{ description: 'The single kind of change this finding asks for.' },
		),
		rootIssue: Type.String({
			description: 'What is wrong in the current code, in one sentence.',
		}),
		consequence: Type.String({
			description:
				'What actually goes wrong if the code stays. No real consequence means no finding.',
		}),
		benefit: Type.String({
			description: 'The concrete gain after the fix.',
		}),
		evidence: Type.String({
			description:
				'The exact current line(s) quoted, plus the existing symbol and file for a reuse finding.',
		}),
	},
	{ additionalProperties: false },
)

export const FindingsPayloadSchema = Type.Object(
	{
		lens: Type.Union([
			Type.Literal('reuse'),
			Type.Literal('quality'),
			Type.Literal('efficiency'),
		]),
		findings: Type.Array(FindingSchema, { maxItems: MAX_FINDINGS }),
		notes: Type.Optional(
			Type.String({
				description:
					'Out-of-scope observations only. Never put a finding here.',
			}),
		),
	},
	{ additionalProperties: false },
)

export type FindingsPayload = Static<typeof FindingsPayloadSchema>

export interface LensTaskInput {
	manifest: ScopeManifest
	manifestPath: string
	/** Present only when the scope has a diff at all. */
	focus?: string
}

export function lensTask(lens: Lens, input: LensTaskInput): string {
	return joinLines([
		`Lens: ${lens}.`,
		LENS_TASKS[lens],
		'',
		`Repository root: ${input.manifest.repoRoot}`,
		`Scope manifest, read it first: ${input.manifestPath}`,
		'It lists every file in scope with its changed line ranges; "wholeFile": true means the whole file is in scope. The current file contents are authoritative - the ranges only say what changed.',
		input.manifest.diffCommand
			? `The change itself, when your shell can reach that path: \`${input.manifest.diffCommand}\` (append \`-- <path>\` to narrow it). If it cannot, the current file contents and the ranges below are enough.`
			: 'There is no diff: every file in the manifest is fully in scope.',
		input.focus ? `Extra emphasis for this run: ${input.focus}` : undefined,
		'',
		`Report only findings inside the scope, at most ${MAX_FINDINGS}, most important first. End with exactly one structured_output call matching the schema: an honest empty list is a valid answer and beats speculation.`,
	])
}

/** The fanout script the parent model launches; a file, so it cannot be mistyped. */
export function buildWorkflowScript(input: LensTaskInput): string {
	const children = LENSES.map(lens => ({
		key: lens,
		agent: SIMPLIFIER_AGENT,
		phase: ANALYSIS_PHASE,
		label: `${lens} lens`,
		task: lensTask(lens, input),
		output: false,
		progress: false,
		outputSchema: FindingsPayloadSchema,
	}))
	return joinLines([
		`const results = await runs.all(${JSON.stringify(children, null, JSON_INDENT)});`,
		'return results.map((result) => ({',
		'\tkey: result.key,',
		'\tstructuredOutput: result.structuredOutput ?? null,',
		'\terror: result.error ?? null,',
		'}));',
	])
}

export function buildDispatchMessage(
	scriptPath: string,
	needsToolActivation: boolean,
): string {
	return joinLines([
		'Run the /simplify analysis now.',
		'',
		needsToolActivation
			? 'The `subagent` tool is configured but not active in this session. Call `load_tools` with `{"names": ["subagent"]}` first.'
			: undefined,
		'Call the `subagent` tool exactly once with these arguments, verbatim:',
		'',
		'```json',
		JSON.stringify(
			{
				async: false,
				context: 'fresh',
				mission: false,
				workflowScriptPath: scriptPath,
			},
			null,
			JSON_INDENT,
		),
		'```',
		'',
		'Do not add, rename, reorder or explain anything, and do not read files, run commands or call any other tool: the three lens children are the analysis, and their structured findings are read from the tool result.',
		'When the call returns, reply with one line: `analysis complete`.',
	])
}

function joinLines(entries: ReadonlyArray<string | undefined>): string {
	return entries
		.filter((entry): entry is string => typeof entry === 'string')
		.join('\n')
}
