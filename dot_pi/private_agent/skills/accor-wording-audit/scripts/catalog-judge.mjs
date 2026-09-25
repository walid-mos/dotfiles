// node catalog-judge.mjs <prepared.json> <out.json> [--reuse previous.json]
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

import { requestMatches } from './catalog-jev.mjs'

const CHUNK_SIZE = 40
const CONFIDENCE_GATE = 0.95
const JUDGE_VERSION = 1
const CLI_ARGS = 2
const CHOICE_PREFIX_LENGTH = 1
const REUSE_ARGS = 4
const JSON_INDENT = 2

const stderr = text => process.stderr.write(`${text}\n`)
const fail = text => {
	throw new Error(text)
}
const digest = input => createHash('sha256').update(input).digest('hex')

function validConfidence(confidence) {
	return (
		typeof confidence === 'number' &&
		Number.isFinite(confidence) &&
		confidence >= 0 &&
		confidence <= 1
	)
}

function answerFor(pair, answer) {
	const selected = answer?.choice
	const candidate = /^c[0-7]$/.test(selected ?? '')
		? pair.candidates[Number(selected.slice(CHOICE_PREFIX_LENGTH))]
		: null
	if (
		(selected !== 'no_match' && !candidate) ||
		!validConfidence(answer?.confidence)
	) {
		fail(`${pair.key}: invalid or missing Jev answer`)
	}
	const differs =
		Boolean(candidate) &&
		(pair.fr !== candidate.fr || pair.en !== candidate.en)
	let status = 'unpaired'
	if (candidate)
		status = differs ? 'candidate_text_differs' : 'exact_candidate'
	return {
		key: pair.key,
		app: { fr: pair.fr, en: pair.en },
		candidates: pair.candidates,
		source: 'jev',
		choice: selected,
		confidence: answer.confidence,
		candidate: candidate ?? null,
		status,
		needsReview:
			!candidate || differs || answer.confidence < CONFIDENCE_GATE,
		needsPairingCheck: Boolean(candidate),
	}
}

function deterministic(pair) {
	if (pair.status === 'approved_cache') {
		const review = pair.approvedReview
		return {
			key: pair.key,
			app: { fr: pair.fr, en: pair.en },
			candidates: [],
			source: 'approved_cache',
			choice: review.choice,
			confidence: review.confidence,
			candidate: review.candidate,
			status: 'approved_mapping',
			needsReview: false,
			needsPairingCheck: false,
			approvedReview: review,
		}
	}
	const candidate = pair.candidates[0] ?? null
	return {
		key: pair.key,
		app: { fr: pair.fr, en: pair.en },
		candidates: pair.candidates,
		source: pair.status,
		choice: null,
		confidence: null,
		candidate,
		status:
			pair.status === 'exact_candidate' ? 'exact_candidate' : 'unpaired',
		needsReview: pair.status !== 'exact_candidate',
		needsPairingCheck: Boolean(candidate),
	}
}

function previousAnswers(file) {
	if (!file) return new Map()
	const saved = JSON.parse(readFileSync(file, 'utf8'))
	if (saved.judgeVersion !== JUDGE_VERSION) {
		fail('reuse judge version differs; rebuild judgments')
	}
	const entries = saved.completed ?? saved.results
	if (!Array.isArray(entries)) fail('reuse file lacks completed judgments')
	const answers = new Map()
	for (const entry of entries) {
		if (answers.has(entry.key)) fail(`duplicate reused key: ${entry.key}`)
		answers.set(entry.key, entry)
	}
	return answers
}

function writeProgress(file, hash, completed) {
	writeFileSync(
		file,
		`${JSON.stringify({ inputHash: hash, judgeVersion: JUDGE_VERSION, completed: [...completed.values()] })}\n`,
	)
}

function options() {
	const [preparedFile, outFile, flag, reuseFile] =
		process.argv.slice(CLI_ARGS)
	if (
		!preparedFile ||
		!outFile ||
		(flag && (flag !== '--reuse' || !reuseFile)) ||
		process.argv.length > REUSE_ARGS + CLI_ARGS
	) {
		fail(
			'usage: catalog-judge.mjs <prepared.json> <out.json> [--reuse previous.json]',
		)
	}
	if (preparedFile === outFile || outFile === reuseFile)
		fail('input, output and reuse paths must differ')
	return { preparedFile, outFile, reuseFile }
}

function loadPrepared(file) {
	const input = readFileSync(file, 'utf8')
	const prepared = JSON.parse(input)
	if (
		!Array.isArray(prepared.pairs) ||
		!prepared.pairs.length ||
		prepared.pairs.length !== prepared.appKeys
	) {
		fail('prepared catalog has incomplete app coverage')
	}
	return { prepared, hash: digest(input) }
}

function reusable(pair, cached) {
	return (
		cached?.source === 'jev' &&
		cached.key === pair.key &&
		cached.app?.fr === pair.fr &&
		cached.app?.en === pair.en &&
		JSON.stringify(cached.candidates) === JSON.stringify(pair.candidates)
	)
}

async function complete(prepared, previous, hash, progressFile) {
	const completed = new Map()
	for (const pair of prepared.pairs) {
		const cached = previous.get(pair.key)
		if (pair.status === 'needs_jev' && reusable(pair, cached)) {
			completed.set(pair.key, answerFor(pair, cached))
		}
	}
	const pending = prepared.pairs.filter(
		pair => pair.status === 'needs_jev' && !completed.has(pair.key),
	)
	if (pending.length && !process.env.TYPESAFE_API_KEY?.trim())
		fail('TYPESAFE_API_KEY missing')
	let requests = 0
	for (let start = 0; start < pending.length; start += CHUNK_SIZE) {
		const chunk = pending.slice(start, start + CHUNK_SIZE)
		// oxlint-disable-next-line no-await-in-loop
		const response = await requestMatches(chunk)
		requests += response.requests
		for (const pair of chunk)
			completed.set(pair.key, answerFor(pair, response.answers[pair.key]))
		writeProgress(progressFile, hash, completed)
		stderr(`catalog Jev ${start + chunk.length}/${pending.length} answered`)
	}
	return { completed, sent: pending.length, requests }
}

function outputFor(prepared, hash, completed, stats) {
	const results = prepared.pairs.map(pair =>
		pair.status === 'needs_jev'
			? completed.get(pair.key)
			: deterministic(pair),
	)
	if (results.some(decision => !decision)) fail('incomplete Jev decisions')
	return {
		inputHash: hash,
		judgeVersion: JUDGE_VERSION,
		sourceRoots: prepared.sourceRoots,
		snapshotHash: prepared.snapshotHash,
		removedKeys: prepared.removedKeys,
		appRevision: prepared.appRevision,
		protoRevision: prepared.protoRevision,
		appKeys: prepared.appKeys,
		unresolvedPrototype: prepared.unresolved,
		results,
		counts: {
			total: results.length,
			sent: stats.sent,
			requests: stats.requests,
			reused: completed.size - stats.sent,
			approvedReused: results.filter(
				decision => decision.source === 'approved_cache',
			).length,
			exactCandidates: results.filter(
				decision => decision.status === 'exact_candidate',
			).length,
			review: results.filter(decision => decision.needsReview).length,
			pairingChecks: results.filter(
				decision => decision.needsPairingCheck,
			).length,
		},
	}
}

async function main() {
	const { preparedFile, outFile, reuseFile } = options()
	const { prepared, hash } = loadPrepared(preparedFile)
	const progressFile = `${outFile}.progress`
	const { completed, sent, requests } = await complete(
		prepared,
		previousAnswers(reuseFile),
		hash,
		progressFile,
	)
	const output = outputFor(prepared, hash, completed, { sent, requests })
	writeFileSync(outFile, `${JSON.stringify(output, null, JSON_INDENT)}\n`)
	if (sent) unlinkSync(progressFile)
	stderr(`wrote ${outFile}; ${JSON.stringify(output.counts)}`)
}

await main()
