const API_URL = 'https://api.typesafe.ai/v1/systemone'
const MAX_ATTEMPTS = 5
const BACKOFF_MS = 2000
const ERROR_LIMIT = 400
const REQUEST_TIMEOUT_MS = 30000
const HTTP_TOO_MANY = 429
const HTTP_INTERNAL = 500
const HTTP_BAD_GATEWAY = 502
const HTTP_UNAVAILABLE = 503
const HTTP_GATEWAY_TIMEOUT = 504
const HTTP_RETRY = new Set([
	HTTP_TOO_MANY,
	HTTP_INTERNAL,
	HTTP_BAD_GATEWAY,
	HTTP_UNAVAILABLE,
	HTTP_GATEWAY_TIMEOUT,
])

function questionFor(pair) {
	const criteria = Object.fromEntries(
		pair.candidates.map((candidate, index) => [
			`c${index}`,
			`${candidate.id} (${candidate.ref}): FR ${JSON.stringify(candidate.fr)}; EN ${JSON.stringify(candidate.en)}`,
		]),
	)
	criteria.no_match =
		'No candidate is the same UI element, or the given catalog strings are insufficient to identify it.'
	return {
		type: 'choice',
		instructions: {
			app_key: pair.key,
			app_fr: pair.fr,
			app_en: pair.en,
			question:
				'Which prototype entry describes the SAME UI element in both languages? Match element intent, not just shared words; a different element with identical wording is not a match. If uncertain or none fits, select no_match. The list contains only catalog literals; the true string may be in JSX or dynamically composed.',
		},
		criteria,
	}
}

async function callJev(chunk) {
	const questions = Object.fromEntries(
		chunk.map(pair => [pair.key, questionFor(pair)]),
	)
	const response = await fetch(API_URL, {
		method: 'POST',
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		headers: {
			Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			state: {
				context:
					'Pair the app and prototype catalogs for a wording audit. Do not invent correspondences. Both locales describe one UI element.',
			},
			model: 'jev-latest',
			questions,
		}),
	})
	if (HTTP_RETRY.has(response.status)) return null
	if (!response.ok)
		throw new Error(
			`Jev HTTP ${response.status}: ${(await response.text()).slice(0, ERROR_LIMIT)}`,
		)
	const payload = await response.json()
	if (!payload?.answers || typeof payload.answers !== 'object')
		throw new Error('Jev response missing answers')
	return payload.answers
}

export async function requestMatches(chunk) {
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		// oxlint-disable-next-line no-await-in-loop
		const answers = await callJev(chunk)
		if (answers) return { answers, requests: attempt }
		if (attempt < MAX_ATTEMPTS) {
			// oxlint-disable-next-line no-await-in-loop
			await new Promise(resolve =>
				setTimeout(resolve, BACKOFF_MS * attempt),
			)
		}
	}
	throw new Error(`Jev failed after ${MAX_ATTEMPTS} attempts`)
}
