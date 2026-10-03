// Jev HTTP boundary and request API. response.ts validates the untrusted reply.
// Extensions carry no runtime dependency.
// API: POST /v1/systemone, body {state, questions, model} → {model, answers, usage}.
import { readAnswers, readChoice, readMeta } from './response.ts'

/** Pinned: `jev-latest` moves, and thresholds tuned against one version must not drift. */
export const JEV_MODEL = 'jev-1.13.0'
/** Input-only billing; output tokens are free. */
const USD_PER_MTOK = 0.042
const TOKENS_PER_MTOK = 1_000_000
export const JEV_USD_PER_INPUT_TOKEN = USD_PER_MTOK / TOKENS_PER_MTOK
const DEFAULT_TIMEOUT_MS = 15_000
const ERROR_BODY_CHARS = 300
export const JEV_API_URL = 'https://api.typesafe.ai/v1/systemone'

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
	signal?: AbortSignal | undefined
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
	answers: Record<
		string,
		Omit<ChoiceResult, 'model' | 'inputTokens' | 'latencyMs'>
	>
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
			Object.keys(questions).map(name => [
				name,
				readChoice(post.body, name),
			]),
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
	const timeoutSignal = AbortSignal.timeout(
		options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
	)
	const signal = options.signal
		? AbortSignal.any([options.signal, timeoutSignal])
		: timeoutSignal
	const response = await (options.fetchImpl ?? fetch)(JEV_API_URL, {
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
		signal,
	})
	if (!response.ok) {
		const detail = (await response.text()).slice(0, ERROR_BODY_CHARS)
		throw new Error(`jev HTTP ${response.status}: ${detail}`)
	}
	const body: unknown = await response.json()
	return { body, ...readMeta(body), latencyMs: Date.now() - started }
}
