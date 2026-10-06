/** Display-only preview of a codemode script: the tools it calls, its `@options` line, and the
 * nested-call outcome of its result. Never evaluates the script. */
import { reflectMember } from '#lib/ui/pi-members.ts'

import {
	count,
	outputLineCount,
	payloadNumber,
	payloadText,
} from './tool-payload.ts'

import type { ToolOutput } from './tool-payload.ts'
import type { ToolPresentation } from './tool-presentation.ts'

const MS_PER_SECOND = 1000
const TOKENS_PER_K = 1000
/** The header pi prints before a script's own output. */
const RESULT_HEADER =
	/^Script (?:completed|failed)\n(?:Wall time [^\n]*\n)?(?:Output:\n?)?\n?/u

interface ScriptOptions {
	outputTokens?: number | undefined
	timeoutMs?: number | undefined
}

/** The `tools.<name>(` calls a script makes, in order of first use, with repeat counts. */
function scriptToolCalls(code: string): string {
	const counts = new Map<string, number>()
	for (const match of code.matchAll(/\btools\.([A-Za-z_$][\w$]*)\s*\(/gu)) {
		const name = match[1] ?? ''
		counts.set(name, (counts.get(name) ?? 0) + 1)
	}
	return [...counts]
		.map(([name, total]) =>
			total > 1 ? `${name} ×${String(total)}` : name,
		)
		.join(' · ')
}

/** The first line that is code, for a script that calls no tool directly. */
function firstCodeLine(code: string): string {
	return (
		code
			.split(/\r?\n/u)
			.map(line => line.trim())
			.find(line => line && !line.startsWith('//')) ?? ''
	)
}

/** The optional `// @options: {...}` first line; anything unparsable reads as no options. */
function scriptOptions(code: string): ScriptOptions {
	const first = code.trimStart().split(/\r?\n/u)[0] ?? ''
	const match = /^\/\/\s*@options:\s*(\{.*\})\s*$/u.exec(first)
	if (!match) return {}
	try {
		const parsed: unknown = JSON.parse(match[1] ?? '')
		return {
			outputTokens: payloadNumber(parsed, 'max_output_tokens'),
			timeoutMs: payloadNumber(parsed, 'timeout_ms'),
		}
	} catch {
		return {}
	}
}

function tokenBudget(tokens: number): string {
	return tokens >= TOKENS_PER_K
		? `${String(Math.round(tokens / TOKENS_PER_K))}k`
		: String(tokens)
}

/** Nested calls with their failures, then what the script itself printed. */
function codemodeSummary(output: ToolOutput): string {
	const calls = reflectMember(output.details, 'calls')
	const list: unknown[] = Array.isArray(calls) ? calls : []
	const failed = list.filter(
		call => payloadText(call, 'status') === 'error',
	).length
	const printed = output.imageCount
		? count('image', output.imageCount)
		: count('line', outputLineCount(output.text.replace(RESULT_HEADER, '')))
	return [
		list.length ? `${String(list.length)} calls` : '',
		failed ? `${String(failed)} failed` : '',
		printed,
	]
		.filter(Boolean)
		.join(' · ')
}

export function codemodePresentation(args: unknown): ToolPresentation {
	const code = payloadText(args, 'code')
	const { outputTokens, timeoutMs } = scriptOptions(code)
	return {
		label: 'codemode',
		subject: scriptToolCalls(code) || firstCodeLine(code) || 'script',
		annotation: [
			`${count('line', outputLineCount(code))} script`,
			outputTokens ? `out ${tokenBudget(outputTokens)}` : '',
		]
			.filter(Boolean)
			.join(' · '),
		timeoutSeconds: timeoutMs ? timeoutMs / MS_PER_SECOND : undefined,
		summary: codemodeSummary,
		body: 'text',
	}
}
