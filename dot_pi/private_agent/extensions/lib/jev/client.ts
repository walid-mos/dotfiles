// Jev (TypeSafe System One) boundary: the only module that speaks the HTTP API.
// Fetch-based on purpose - extensions carry no runtime dependency, and one client
// serves both the eval scripts and the future shadow collector.
//
// API: POST /v1/systemone, body {state, questions, model} → {model, answers, usage}.

/** Pinned: `jev-latest` moves, and thresholds tuned against one version must not drift. */
export const JEV_MODEL = 'jev-1.13.0'
/** Input-only billing; output tokens are free. */
const USD_PER_MTOK = 0.042
const TOKENS_PER_MTOK = 1_000_000
export const JEV_USD_PER_INPUT_TOKEN = USD_PER_MTOK / TOKENS_PER_MTOK
const DEFAULT_TIMEOUT_MS = 15_000
const ERROR_BODY_CHARS = 300
const API_URL = 'https://api.typesafe.ai/v1/systemone'

export type NoulAnswers = Readonly<Record<string, number>>

export type JevResult = {
	model: string
	answers: NoulAnswers
	inputTokens: number
	latencyMs: number
}

export type ChoiceQuestion = {
	/** The decision to make, including the border rules that resolve close calls. */
	instructions: string
	/** One option per key, each value describing what qualifies. */
	criteria: Record<string, string>
}

export type ChoiceResult = {
	model: string
	choice: string
	/** Concentration of the distribution, not correctness: calibrate it on real pairs. */
	confidence: number
	probabilities: Record<string, number>
	inputTokens: number
	latencyMs: number
}

export type JevOptions = {
	apiKey?: string
	model?: string
	timeoutMs?: number
	fetchImpl?: typeof fetch
}

export function isJevConfigured(): boolean {
	return Boolean(process.env.TYPESAFE_API_KEY?.trim())
}

export function estimateUsd(inputTokens: number): number {
	return inputTokens * JEV_USD_PER_INPUT_TOKEN
}

export function missingKeyError(): Error {
	return new Error(
		'TYPESAFE_API_KEY is not set - add it to ~/.config/zsh/secrets and restart the session',
	)
}

/** One request, one answer per question name. Throws on any non-2xx or malformed answer. */
export async function askNouls(
	state: unknown,
	instructions: Record<string, string>,
	options: JevOptions = {},
): Promise<JevResult> {
	const questions = Object.fromEntries(
		Object.entries(instructions).map(([name, text]) => [
			name,
			{ type: 'noul', instructions: text },
		]),
	)
	const post = await postJev(state, questions, options)
	return {
		model: post.model,
		inputTokens: post.inputTokens,
		latencyMs: post.latencyMs,
		answers: readAnswers(post.body, Object.keys(instructions)),
	}
}

/** One Choice decision: the model picks exactly one option and reports the spread. */
export async function askChoice(
	state: unknown,
	question: ChoiceQuestion,
	options: JevOptions = {},
): Promise<ChoiceResult> {
	const answers = await askChoices(state, { decision: question }, options)
	const answer = answers.answers.decision
	if (!answer) throw new Error('jev returned no answer for "decision"')
	return { ...answers.meta, ...answer }
}

export type ChoiceAnswers = {
	meta: { model: string; inputTokens: number; latencyMs: number }
	answers: Record<string, Omit<ChoiceResult, 'model' | 'inputTokens' | 'latencyMs'>>
}

/**
 * Several Choice questions over ONE state, in one request: a whole page checked
 * against a spec list costs a single call.
 */
export async function askChoices(
	state: unknown,
	questions: Record<string, ChoiceQuestion>,
	options: JevOptions = {},
): Promise<ChoiceAnswers> {
	const post = await postJev(
		state,
		Object.fromEntries(
			Object.entries(questions).map(([name, question]) => [
				name,
				{
					type: 'choice',
					instructions: question.instructions,
					criteria: question.criteria,
				},
			]),
		),
		options,
	)
	return {
		meta: {
			model: post.model,
			inputTokens: post.inputTokens,
			latencyMs: post.latencyMs,
		},
		answers: Object.fromEntries(
			Object.keys(questions).map(name => [name, readChoice(post.body, name)]),
		),
	}
}

type Post = {
	body: unknown
	model: string
	inputTokens: number
	latencyMs: number
}

async function postJev(
	state: unknown,
	questions: Record<string, unknown>,
	options: JevOptions,
): Promise<Post> {
	const apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY?.trim()
	if (!apiKey) throw missingKeyError()
	const started = Date.now()
	const response = await (options.fetchImpl ?? fetch)(API_URL, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${apiKey}`,
			'content-type': 'application/json',
		},
		body: JSON.stringify({
			state,
			questions,
			model: options.model ?? JEV_MODEL,
		}),
		signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
	})
	if (!response.ok) {
		const detail = (await response.text()).slice(0, ERROR_BODY_CHARS)
		throw new Error(`jev HTTP ${response.status}: ${detail}`)
	}
	const body: unknown = await response.json()
	return { body, ...readMeta(body), latencyMs: Date.now() - started }
}

function readMeta(body: unknown): { model: string; inputTokens: number } {
	const model = prop(body, 'model')
	const usage = prop(body, 'usage')
	return {
		model: typeof model === 'string' ? model : 'unknown',
		inputTokens: readNumber(prop(usage, 'input_tokens')),
	}
}

function readAnswers(body: unknown, names: string[]): NoulAnswers {
	const raw = prop(body, 'answers')
	const answers: Record<string, number> = {}
	for (const name of names) {
		const probability = readNumber(prop(prop(raw, name), 'noul'))
		if (
			!Number.isFinite(probability) ||
			probability < 0 ||
			probability > 1
		) {
			throw new Error(`jev returned no usable answer for "${name}"`)
		}
		answers[name] = probability
	}
	return answers
}

function readChoice(
	body: unknown,
	name: string,
): {
	choice: string
	confidence: number
	probabilities: Record<string, number>
} {
	const answer = prop(prop(body, 'answers'), name)
	const choice = prop(answer, 'choice')
	const confidence = readNumber(prop(answer, 'confidence'))
	if (typeof choice !== 'string' || !choice) {
		throw new Error(`jev returned no choice for "${name}"`)
	}
	if (!Number.isFinite(confidence)) {
		throw new Error(`jev returned no confidence for "${name}"`)
	}
	return {
		choice,
		confidence,
		probabilities: readProbabilities(prop(answer, 'probabilities')),
	}
}

function readProbabilities(raw: unknown): Record<string, number> {
	if (typeof raw !== 'object' || raw === null) return {}
	const probabilities: Record<string, number> = {}
	for (const [option, rawProbability] of Object.entries(raw)) {
		const probability = readNumber(rawProbability)
		if (Number.isFinite(probability)) probabilities[option] = probability
	}
	return probabilities
}

/** Safe property read: the API response is untrusted shape until validated here. */
function prop(source: unknown, key: string): unknown {
	if (typeof source !== 'object' || source === null) return undefined
	return Reflect.get(source, key)
}

function readNumber(raw: unknown): number {
	return typeof raw === 'number' && Number.isFinite(raw) ? raw : Number.NaN
}
