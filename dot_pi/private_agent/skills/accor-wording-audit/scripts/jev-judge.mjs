// Character-exact wording gate. Usage:
// node jev-judge.mjs [--validate] [--scope keys.txt] [--reuse previous.jsonl] fr.json en.json rows.json... out.jsonl
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'

import { JUDGE_VERSION, loadRows } from './rows.mjs'

const API_URL = 'https://api.typesafe.ai/v1/systemone'
const CHUNK_SIZE = 60
const MAX_ATTEMPTS = 5
const RETRY_BACKOFF_MS = 2000
const REQUEST_TIMEOUT_MS = 30000
const CONFIDENCE_GATE = 0.95
const CHOICES = new Set([
	'abstraction_only',
	'wording_differs',
	'different_element',
])
const HTTP_TOO_MANY = 429
const HTTP_INTERNAL = 500
const HTTP_BAD_GATEWAY = 502
const HTTP_UNAVAILABLE = 503
const HTTP_GATEWAY_TIMEOUT = 504
const ERROR_BODY_LIMIT = 400
const ARGV_START = 2
const VALIDATE_MIN_ARGS = 3
const JUDGE_MIN_ARGS = 4
const RETRY_STATUSES = new Set([
	HTTP_TOO_MANY,
	HTTP_INTERNAL,
	HTTP_BAD_GATEWAY,
	HTTP_UNAVAILABLE,
	HTTP_GATEWAY_TIMEOUT,
])
const stderr = message => process.stderr.write(`${message}\n`)
const fail = message => {
	throw new Error(message)
}

const questionFor = pair => ({
	type: 'choice',
	instructions: {
		element: `i18n key ${pair.key}, locale "${pair.locale}"${pair.form ? `, plural form "${pair.form}"` : ''}, rendered by the app component at ${pair.usage}`,
		app_final_rendered_string: pair.app,
		prototype_final_rendered_string: pair.proto,
		prototype_reference: pair.protoRef,
		question:
			'For the SAME UI element, app_final_rendered_string and prototype_final_rendered_string differ. Classify the difference. Note: i18next placeholders like {{count}} or {{name}} are filled at render time; the prototype writes literals or its own tokens ({n}, {name}, {pct}). A component may also append the product/menu names right after a prefix like "Missing : 3 products among" + the names list - such an omitted trailing list is supplied by the composition, not missing wording.',
	},
	criteria: {
		abstraction_only:
			'Word for word the same text; the only differences are placeholder tokens or variable naming ({{count}} vs {n} vs a literal like 1, {{name}} vs {name}, {{size}}, {{max}}, {{pct}}), or one side omits only a trailing placeholder/list that the app component supplies immediately after (names following a "among"/"parmi" prefix).',
		wording_differs:
			'A real text difference beyond placeholder naming: different words, singular/plural agreement, punctuation, spacing (including non-breaking spaces and space before a colon), apostrophe or quote style, or words present on one side only.',
		different_element:
			'The prototype reference is not actually the same UI element as the app one - the app string has no true prototype counterpart (app-specific state).',
	},
})

function applyAnswer(pair, answer) {
	if (
		!CHOICES.has(answer?.choice) ||
		typeof answer.confidence !== 'number' ||
		!Number.isFinite(answer.confidence) ||
		answer.confidence < 0 ||
		answer.confidence > 1
	) {
		fail(`${pair.id}: missing or invalid Jev answer`)
	}
	return {
		...pair,
		choice: answer.choice,
		confidence: answer.confidence,
		verdict: answer.choice,
		flagged:
			answer.choice !== 'abstraction_only' ||
			answer.confidence < CONFIDENCE_GATE,
	}
}

function reuseAnswers(pairs, file) {
	if (!file) return pairs
	const previous = new Map()
	for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
		const judgment = JSON.parse(line)
		if (previous.has(judgment.id))
			fail(`duplicate previous judgment: ${judgment.id}`)
		previous.set(judgment.id, judgment)
	}
	return pairs.map(pair => {
		if (pair.verdict !== 'differ') return pair
		const old = previous.get(pair.id)
		if (
			!old ||
			!CHOICES.has(old.choice) ||
			old.judgeVersion !== JUDGE_VERSION ||
			['app', 'proto', 'protoRef', 'usage', 'key', 'locale', 'form'].some(
				field => old[field] !== pair[field],
			)
		)
			return pair
		return applyAnswer(pair, old)
	})
}

async function callJev(chunk) {
	const questions = Object.fromEntries(
		chunk.map(pair => [pair.id, questionFor(pair)]),
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
					'Character-exact wording audit of an app against its prototype (source of truth). These pairs are already known not to be byte-identical; the choice classifies why, with confidence.',
			},
			model: 'jev-latest',
			questions,
		}),
	})
	if (RETRY_STATUSES.has(response.status)) return null
	if (!response.ok)
		fail(
			`HTTP ${response.status}: ${(await response.text()).slice(0, ERROR_BODY_LIMIT)}`,
		)
	const payload = await response.json()
	if (!payload?.answers || typeof payload.answers !== 'object')
		fail('Jev response missing answers')
	return payload.answers
}

async function retryJev(chunk, start) {
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		// oxlint-disable-next-line no-await-in-loop
		const answers = await callJev(chunk)
		if (answers) return answers
		if (attempt < MAX_ATTEMPTS) {
			// oxlint-disable-next-line no-await-in-loop
			await new Promise(resolve =>
				setTimeout(resolve, RETRY_BACKOFF_MS * attempt),
			)
		}
	}
	fail(`Jev chunk at ${start} failed after ${MAX_ATTEMPTS} attempts`)
}

async function judge(pairs, onProgress) {
	const differ = pairs.filter(pair => pair.verdict === 'differ')
	if (differ.length && !process.env.TYPESAFE_API_KEY?.trim())
		fail('TYPESAFE_API_KEY missing')
	const judged = new Map()
	for (let start = 0; start < differ.length; start += CHUNK_SIZE) {
		const chunk = differ.slice(start, start + CHUNK_SIZE)
		// oxlint-disable-next-line no-await-in-loop
		const answers = await retryJev(chunk, start)
		for (const pair of chunk)
			judged.set(pair.id, applyAnswer(pair, answers[pair.id]))
		onProgress([...judged.values()])
		stderr(`jev chunk ${start + chunk.length}/${differ.length} ok`)
	}
	return {
		sent: differ.length,
		pairs: pairs.map(pair => judged.get(pair.id) ?? pair),
	}
}

function options(args) {
	let isValidateOnly = false
	let scopeFile = null
	let reuseFile = null
	if (args[0] === '--validate') {
		isValidateOnly = true
		args.shift()
	}
	if (args[0] === '--scope') {
		args.shift()
		scopeFile = args.shift()
	}
	if (args[0] === '--reuse') {
		args.shift()
		reuseFile = args.shift()
	}
	if (args.length < (isValidateOnly ? VALIDATE_MIN_ARGS : JUDGE_MIN_ARGS)) {
		fail(
			'usage: jev-judge.mjs [--validate] [--scope keys.txt] [--reuse previous.jsonl] fr.json en.json rows.json... out.jsonl',
		)
	}
	const [frFile, enFile, ...rest] = args
	let outFile = null
	if (!isValidateOnly) outFile = rest.pop()
	return {
		isValidateOnly,
		scopeFile,
		reuseFile,
		frFile,
		enFile,
		rest,
		outFile,
	}
}

function summarize(pairs, rows, sent, reused) {
	const counts = {
		rows: rows.length,
		judgments: pairs.length,
		sent,
		reused,
		flagged: 0,
	}
	for (const pair of pairs) {
		counts[pair.verdict] = (counts[pair.verdict] ?? 0) + 1
		if (pair.flagged) counts.flagged++
	}
	return counts
}

async function main() {
	const {
		isValidateOnly,
		scopeFile,
		reuseFile,
		frFile,
		enFile,
		rest,
		outFile,
	} = options(process.argv.slice(ARGV_START))
	const { rows, items } = loadRows(frFile, enFile, rest, scopeFile)
	if (isValidateOnly) {
		stderr(`validated ${JSON.stringify(summarize(items, rows, 0, 0))}`)
		return
	}
	const reusedPairs = reuseAnswers(items, reuseFile)
	const reused = reusedPairs.filter(pair => pair.choice !== null).length
	const progressFile = `${outFile}.progress`
	const { sent, pairs } = await judge(reusedPairs, judged => {
		const completed = [
			...reusedPairs.filter(pair => pair.choice !== null),
			...judged,
		]
		writeFileSync(
			progressFile,
			`${completed.map(pair => JSON.stringify(pair)).join('\n')}\n`,
		)
	})
	writeFileSync(
		outFile,
		`${pairs.map(pair => JSON.stringify(pair)).join('\n')}\n`,
	)
	if (sent) unlinkSync(progressFile)
	stderr(
		`wrote ${outFile}; ${JSON.stringify(summarize(pairs, rows, sent, reused))}`,
	)
}

await main()
