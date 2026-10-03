/**
 * The analysis contracts: the four lens tasks, the findings schema handed to
 * the children (and reused to validate what they return), the workflow script
 * that runs them within budgets, and the message asking the parent to launch it.
 */

import { Type } from 'typebox'

import type { Static } from 'typebox'
import type { Lens, ScopeManifest } from './types.ts'

export const LENSES = ['reuse', 'quality', 'efficiency', 'solid'] as const

export const SIMPLIFIER_AGENT = 'simplifier'
export const ANALYSIS_PHASE = 'Simplify'
export const MAX_FINDINGS = 40

const JSON_INDENT = 2
const ANALYSIS_TOOL_BUDGET = {
	soft: 24,
	hard: 40,
	block: ['read', 'grep', 'find', 'ls', 'bash'],
} as const
const ANALYSIS_USAGE_BUDGET = { costUsd: { soft: 0.15, hard: 0.25 } }

const LENS_TASKS: Record<Lens, string> = {
	reuse: [
		'Find code in scope that already exists elsewhere in this repository.',
		"Name the exact existing symbol, file and call site for every duplicate or near-duplicate: a helper, a util, a type, a component, a query that a reviewed line reimplements or thinly wraps. When no reusable implementation exists, consider shared extraction under the agent's House ladder.",
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
	solid: [
		'Find files and types in scope whose structure does not match their one job: a file or type juggling unrelated concerns that a split would separate, a module edited on every new case that a dispatch-table entry or an added implementation would extend instead, an implementation that breaks the contract of what it replaces (a surprise throw or null a caller cannot see), a caller handed a wider surface than it uses, or high-level policy importing low-level detail (DB, HTTP, FS) directly.',
		'Judge SOLID at the file and module level. Never demand a speculative abstraction for hypothetical reuse: an interface, layer or indirection must remove an existing concrete cost, and never flag an adapter that isolates an unstable dependency, protects a public API, or marks a domain boundary.',
		'Every finding must name the concrete cost the current structure pays, never a style preference.',
	].join(' '),
}

export const FindingSchema = Type.Object(
	{
		file: Type.String({
			description:
				'Repository-relative path anchoring the reviewed problem, exactly as the scope manifest spells it; supporting files belong in evidence.',
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
		title: Type.String({
			description:
				'A short readable name for the finding: one clause of at most ten words, for example "resetMenuOpen is a redundant field-setter". No file path, no line numbers, no trailing period.',
		}),
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
				'The exact current line(s) quoted, existing reuse symbols or duplicate implementations, and every proposed supporting file with the reason its edit completes this finding.',
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
			Type.Literal('solid'),
		]),
		findings: Type.Array(FindingSchema, { maxItems: MAX_FINDINGS }),
		notes: Type.Optional(
			Type.String({
				description:
					'Independent out-of-scope observations only. Necessary supporting edits belong in the anchored finding, never here.',
			}),
		),
	},
	{ additionalProperties: false },
)

export type FindingsPayload = Static<typeof FindingsPayloadSchema>

// Acceptance stays disabled: its acceptanceReport schema cannot coexist with
// this schema's additionalProperties: false.
const LENS_OUTPUT_CONTRACT = {
	acceptance: false,
	outputSchema: FindingsPayloadSchema,
} as const

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
		`Workspace root: ${input.manifest.workspaceRoot}`,
		`Scope manifest, read it first: ${input.manifestPath}`,
		'It lists every reviewed file with its changed line ranges; "wholeFile": true means the whole file is reviewed. The current file contents are authoritative. Follow the agent\'s Scope invariant: these ranges anchor findings, not an edit allowlist.',
		input.manifest.diffCommand
			? `Use the current code and manifest ranges first. Only when a finding needs a before/after comparison, run \`${input.manifest.diffCommand} -- <path>\` for that file. If the diff is unavailable, current contents and ranges are enough.`
			: 'This is a direct-file scope with no Git diff: every file in the manifest is fully in scope.',
		input.focus ? `Extra emphasis for this run: ${input.focus}` : undefined,
		'',
		`Use at most ${ANALYSIS_TOOL_BUDGET.hard} tool calls. Read changed regions and their direct dependencies, then finalize from that evidence; report incomplete coverage in notes. Report only findings anchored inside the review scope, at most ${MAX_FINDINGS}, most important first. Include their necessary supporting edits in evidence. End with exactly one structured_output call matching the schema: an honest empty list is a valid answer and beats speculation.`,
	])
}

/** The budgeted script the parent launches; a file, so it cannot be mistyped. */
export function buildWorkflowScript(input: LensTaskInput): string {
	const children = LENSES.map(lens => ({
		key: lens,
		agent: SIMPLIFIER_AGENT,
		phase: ANALYSIS_PHASE,
		label: `${lens} lens`,
		task: lensTask(lens, input),
		output: false,
		progress: false,
		toolBudget: ANALYSIS_TOOL_BUDGET,
		...LENS_OUTPUT_CONTRACT,
	}))
	return joinLines([
		`const children = ${JSON.stringify(children, null, JSON_INDENT)};`,
		'const results = [];',
		'for (const child of children) {',
		'\tconst result = await runs.run(child.key, child);',
		'\tresults.push({ lens: child.key, result });',
		'}',
		'return results.map(({ lens, result }) => ({',
		'\tkey: lens,',
		'\tstructuredOutput: result?.structuredOutput ?? null,',
		'\terror: result?.error ?? null,',
		'}));',
	])
}

export function buildDispatchMessage(scriptPath: string): string {
	return joinLines([
		'Run the /simplify analysis now.',
		'',
		'Call the `subagent` tool exactly once with these arguments, verbatim:',
		'',
		'```json',
		JSON.stringify(
			{
				async: false,
				context: 'fresh',
				mission: false,
				globalConcurrencyLimit: 1,
				maxSubagentSpawnsPerRun: LENSES.length,
				usageBudget: ANALYSIS_USAGE_BUDGET,
				workflow: scriptPath,
			},
			null,
			JSON_INDENT,
		),
		'```',
		'',
		'Do not add, rename, reorder or explain anything, and do not read files, run commands or call any other tool: the four lens children are the analysis, and their structured findings are read from the tool result.',
		'When the call returns, reply with one line: `analysis complete`.',
	])
}

function joinLines(entries: ReadonlyArray<string | undefined>): string {
	return entries
		.filter((entry): entry is string => typeof entry === 'string')
		.join('\n')
}
