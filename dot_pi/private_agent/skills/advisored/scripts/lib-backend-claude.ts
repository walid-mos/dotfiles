import {
	parseJsonRecord,
	readBoolean,
	readNumber,
	readRecord,
	readString,
} from './lib-json-fields.ts'

import type { JsonRecord } from './lib-json-fields.ts'
import type { AdvisorState } from './lib-state.ts'

export const CLAUDE_DEFAULT_MODEL = 'opus'
export const CLAUDE_DEFAULT_EFFORT = 'xhigh'

export type AcceptedReply = {
	text: string
	model: string
	costUsd: number | null
}

export type ReplyCheck =
	| { kind: 'accepted'; reply: AcceptedReply }
	| { kind: 'rejected'; reason: string; text: string | null }

const CLAUDE_RESTRICTIONS = [
	'--safe-mode',
	'--tools',
	'',
	'--disallowedTools',
	'mcp__*',
	'--strict-mcp-config',
	'--mcp-config',
	'{"mcpServers":{}}',
	'--setting-sources',
	'',
	'--no-session-persistence',
]

export function claudeArguments(state: AdvisorState): string[] {
	return [
		'--print',
		'--model',
		state.model,
		'--effort',
		state.effort ?? CLAUDE_DEFAULT_EFFORT,
		...CLAUDE_RESTRICTIONS,
		'--system-prompt-file',
		state.contractPath,
		'--output-format',
		'json',
	]
}

function rejected(reason: string, text: string | null): ReplyCheck {
	return { kind: 'rejected', reason, text }
}

type ModelCheck =
	| { kind: 'confirmed'; model: string }
	| { kind: 'mismatch'; reason: string }

function checkModel(record: JsonRecord, state: AdvisorState): ModelCheck {
	const models = Object.keys(readRecord(record, 'modelUsage') ?? {})
	const [model] = models
	if (!model || models.length !== 1) {
		return {
			kind: 'mismatch',
			reason: `expected one model in modelUsage, got ${models.join(', ') || 'none'}`,
		}
	}
	if (state.rounds.length && model !== state.model) {
		return {
			kind: 'mismatch',
			reason: `model ${model} differs from pinned ${state.model}`,
		}
	}
	return { kind: 'confirmed', model }
}

export function checkClaudeReply(
	stdout: string,
	state: AdvisorState,
): ReplyCheck {
	const record = parseJsonRecord(stdout.trim())
	if (!record) return rejected('stdout is not one JSON object', null)
	const text = readString(record, 'result') ?? null
	const subtype = readString(record, 'subtype') ?? 'missing'
	const isError = readBoolean(record, 'is_error') ?? true
	if (subtype !== 'success' || isError) {
		return rejected(
			`claude reported subtype=${subtype} is_error=${String(isError)}`,
			text,
		)
	}
	if (!text) return rejected('claude returned an empty result', null)
	const model = checkModel(record, state)
	if (model.kind === 'mismatch') return rejected(model.reason, text)
	return {
		kind: 'accepted',
		reply: {
			text,
			model: model.model,
			costUsd: readNumber(record, 'total_cost_usd') ?? null,
		},
	}
}
