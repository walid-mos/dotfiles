/** /usage, pure: one tally over session entries (a branch or JSONL lines) and its text rendering. */

interface ModelUsage {
	calls: number
	cost: number
	contexts: number[]
}

const TOP_MODELS = 6
const MODEL_COLUMN = 34
const CALLS_COLUMN = 5
const COST_COLUMN = 7
const DECIMALS = 2
const MS_PER_MINUTE = 60_000
const PERCENT = 100
const THOUSAND = 1000
const HALF = 2
/** Markers written by tools/guard: a refused lookup and a redirected one. */
const REFUSAL = /^(?:Use the active|tool-guard blocked)/
const REDIRECT = /^Ran through the /

function member(host: unknown, key: string): unknown {
	if (!host || typeof host !== 'object') return undefined
	return Reflect.get(host, key)
}

function numberOf(candidate: unknown): number {
	return typeof candidate === 'number' && Number.isFinite(candidate)
		? candidate
		: 0
}

function textOf(content: unknown): string {
	if (typeof content === 'string') return content
	if (!Array.isArray(content)) return ''
	return content
		.map(part =>
			member(part, 'type') === 'text' ? member(part, 'text') : '',
		)
		.filter((text): text is string => typeof text === 'string')
		.join('\n')
}

function median(samples: readonly number[]): number {
	if (!samples.length) return 0
	const sorted = samples.toSorted((a, b) => a - b)
	return sorted[Math.floor(sorted.length / HALF)] ?? 0
}

function ratio(part: number, whole: number): string {
	return whole ? `${Math.round((part / whole) * PERCENT)}%` : '0%'
}

function kilo(tokens: number): string {
	return `${Math.round(tokens / THOUSAND)}k`
}

function money(cost: number): string {
	return `$${cost.toFixed(DECIMALS)}`
}

/** Counters folded from session entries; `observe` ignores unknown shapes. */
export class UsageTally {
	sessions = 0
	calls = 0
	cost = 0
	prompts = 0
	toolCalls = 0
	toolMessages = 0
	multiToolMessages = 0
	toolErrors = 0
	refusals = 0
	redirects = 0
	apiErrors = 0
	aborted = 0
	overCeiling = 0
	checkpoints = 0
	firstAt = 0
	lastAt = 0
	private readonly byModel = new Map<string, ModelUsage>()

	constructor(private readonly ceiling: number) {}

	countSession(): void {
		this.sessions += 1
	}

	observe(entry: unknown): void {
		const at = Date.parse(String(member(entry, 'timestamp') ?? ''))
		if (Number.isFinite(at)) {
			this.firstAt = this.firstAt ? Math.min(this.firstAt, at) : at
			this.lastAt = Math.max(this.lastAt, at)
		}
		const type = member(entry, 'type')
		if (type === 'compaction') {
			this.checkpoints += 1
			return
		}
		if (type !== 'message') return
		const message = member(entry, 'message')
		const role = member(message, 'role')
		if (role === 'user') this.prompts += 1
		else if (role === 'assistant') this.observeAssistant(message)
		else if (role === 'toolResult') this.observeToolResult(message)
	}

	private observeAssistant(message: unknown): void {
		this.calls += 1
		const usage = member(message, 'usage')
		const cost = numberOf(member(member(usage, 'cost'), 'total'))
		const context =
			numberOf(member(usage, 'input')) +
			numberOf(member(usage, 'cacheRead')) +
			numberOf(member(usage, 'cacheWrite'))
		this.cost += cost
		if (context > this.ceiling) this.overCeiling += 1
		const key = `${String(member(message, 'provider') ?? '?')}/${String(member(message, 'model') ?? '?')}`
		const model = this.byModel.get(key) ?? {
			calls: 0,
			cost: 0,
			contexts: [],
		}
		model.calls += 1
		model.cost += cost
		model.contexts.push(context)
		this.byModel.set(key, model)
		const stop = member(message, 'stopReason')
		if (stop === 'error') this.apiErrors += 1
		if (stop === 'aborted') this.aborted += 1
		const content = member(message, 'content')
		const tools = Array.isArray(content)
			? content.filter(part => member(part, 'type') === 'toolCall').length
			: 0
		if (!tools) return
		this.toolMessages += 1
		this.toolCalls += tools
		if (tools > 1) this.multiToolMessages += 1
	}

	private observeToolResult(message: unknown): void {
		const text = textOf(member(message, 'content'))
		if (REDIRECT.test(text)) this.redirects += 1
		if (member(message, 'isError') !== true) return
		this.toolErrors += 1
		if (REFUSAL.test(text)) this.refusals += 1
	}

	render(title: string): string[] {
		const minutes =
			this.firstAt && this.lastAt
				? Math.round((this.lastAt - this.firstAt) / MS_PER_MINUTE)
				: 0
		const perPrompt = this.prompts
			? (this.calls / this.prompts).toFixed(1)
			: '0'
		const perMessage = this.toolMessages
			? (this.toolCalls / this.toolMessages).toFixed(DECIMALS)
			: '0'
		const lines = [
			`USAGE  ${title} · ${this.calls} calls · ${money(this.cost)} · ${this.prompts} prompts (${perPrompt} calls/prompt)${minutes ? ` · ${minutes} min` : ''}`,
			`  tools ${this.toolCalls} (${perMessage}/msg, ${ratio(this.multiToolMessages, this.toolMessages)} multi) · tool errors ${this.toolErrors} (${ratio(this.toolErrors, this.toolCalls)}) · refusals ${this.refusals} · redirects ${this.redirects}`,
			`  api errors ${this.apiErrors} · aborted ${this.aborted} · over-ceiling calls ${this.overCeiling} · checkpoints ${this.checkpoints}`,
		]
		const models = [...this.byModel.entries()]
			.toSorted(([, a], [, b]) => b.cost - a.cost)
			.slice(0, TOP_MODELS)
		for (const [name, usage] of models) {
			lines.push(
				`  ${name.padEnd(MODEL_COLUMN)} ${String(usage.calls).padStart(CALLS_COLUMN)} calls  ${money(usage.cost).padStart(COST_COLUMN)}  ctx med ${kilo(median(usage.contexts))}`,
			)
		}
		return lines
	}
}
