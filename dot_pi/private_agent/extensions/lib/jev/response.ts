// Validate the untrusted Jev response; transport and question construction live in client.ts.

export function readMeta(body: unknown): {
	model: string
	inputTokens: number
} {
	const model = prop(body, 'model')
	const usage = prop(body, 'usage')
	return {
		model: typeof model === 'string' ? model : 'unknown',
		inputTokens: readNumber(prop(usage, 'input_tokens')),
	}
}

export function readAnswers(
	body: unknown,
	names: string[],
): Record<string, number> {
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

export function readChoice(
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
