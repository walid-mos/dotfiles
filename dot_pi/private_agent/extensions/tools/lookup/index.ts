/**
 * lookup - several independent file lookups in one model round trip.
 *
 * 87 % of tool messages carried a single call and `codemode` was used once in
 * 63 k calls; the model does batch when a batch-shaped tool exists
 * (`frontend_batch`). This tool runs read/grep/find/ls operations through
 * `ctx.executeTool`, so every nested call keeps pi's validation, the shell
 * guard and the tool hooks, and returns one labelled result.
 *
 * Modules:
 *   ops.ts - pure: operation schema, owning-tool arguments, result rendering
 */
import { nestedOptions, nestedText } from '#lib/tools/nested.ts'

import {
	describeOperation,
	lookupParameters,
	renderOutcomes,
	toolArguments,
} from './ops.ts'

import type {
	ExtensionAPI,
	ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import type { LookupOperation, OperationOutcome } from './ops.ts'

const PURPOSE =
	'Run several independent read/grep/find/ls lookups in one call and get every result at once.'

type LookupTool = ToolDefinition<typeof lookupParameters, unknown>

async function executeLookup(
	args: Parameters<LookupTool['execute']>,
): ReturnType<LookupTool['execute']> {
	const [, params, signal, , ctx] = args
	const outcomes: OperationOutcome[] = await Promise.all(
		params.ops.map(async (op: LookupOperation) => {
			const nested = await ctx.executeTool(
				op.tool,
				toolArguments(op),
				nestedOptions(signal),
			)
			return { op, text: nestedText(nested), isError: nested.isError }
		}),
	)
	const rendered = renderOutcomes(outcomes)
	return {
		content: [{ type: 'text', text: rendered.text }],
		details: {
			ops: outcomes.map(outcome => ({
				summary: describeOperation(outcome.op),
				isError: outcome.isError,
				chars: outcome.text.length,
			})),
		},
		isError: rendered.isError,
	}
}

export default function lookup(pi: ExtensionAPI): void {
	pi.registerTool({
		name: 'lookup',
		label: 'lookup',
		description: `${PURPOSE} Use it whenever two or more lookups are known up front (several files to read, a grep plus the files it will point to is NOT known up front). Each op takes the same fields as the tool it names; results are labelled [1], [2], … in order, capped per op and in total. Wait for the result when one lookup decides the next target.`,
		promptSnippet: PURPOSE,
		parameters: lookupParameters,
		annotations: { readOnlyHint: true },
		execute: (...args) => executeLookup(args),
	})
}
