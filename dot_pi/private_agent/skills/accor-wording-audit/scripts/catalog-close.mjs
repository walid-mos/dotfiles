// node catalog-close.mjs <catalog-decisions.json> <reviewed.json> <out.json> [--removed removed.json]
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
	fingerprintKey,
	fingerprintSources,
	MAPPING_VERSION,
} from './mapping-footprint.mjs'
import { prototypeCatalog } from './prototype-catalog.mjs'

const ARGV_START = 2
const REQUIRED_ARGS = 3
const OPTIONAL_ARGS = 2
const JSON_INDENT = 2
const FINAL = new Set([
	'same_element_exact',
	'same_element_composition',
	'no_counterpart_justified',
])
const UNRESOLVED = new Set([
	'same_element_drift',
	'no_counterpart_unnecessary',
	'uncertain',
])
const EXTRA_KINDS = new Set([
	'dev_tool',
	'production_state',
	'accessibility',
	'feature_extra',
])
const loadJson = file => JSON.parse(readFileSync(file, 'utf8'))
const fail = message => {
	throw new Error(message)
}

function checkEvidence(judgment, review) {
	if (
		(review.usage !== 'unused' &&
			(typeof review.usage !== 'string' ||
				!review.usage.includes(':'))) ||
		typeof review.protoRef !== 'string' ||
		!review.protoRef.trim()
	) {
		fail(
			`${judgment.key}: cite app usage and prototype element or introuvable`,
		)
	}
	if (
		judgment.candidate &&
		review.protoRef !== judgment.candidate.ref &&
		!review.overrideReason?.trim()
	) {
		fail(
			`${judgment.key}: prototype reference changed without a pairing reason`,
		)
	}
}

function checkExact(judgment, review) {
	if (review.usage === 'unused')
		fail(`${judgment.key}: unused key cannot be a verified UI element`)
	const { candidate } = judgment
	if (
		!candidate ||
		!['exact_candidate', 'approved_mapping'].includes(judgment.status) ||
		judgment.app.fr !== candidate.fr ||
		judgment.app.en !== candidate.en ||
		review.protoRef !== candidate.ref
	) {
		fail(
			`${judgment.key}: exact requires a confirmed, byte-identical same-element candidate`,
		)
	}
}

function checkNoCounterpart(judgment, review) {
	if (review.protoRef !== 'introuvable' || !review.searchEvidence?.trim()) {
		fail(
			`${judgment.key}: no counterpart requires a documented prototype search`,
		)
	}
	if (review.decision !== 'no_counterpart_justified') return
	if (review.usage === 'unused' || !EXTRA_KINDS.has(review.extraKind)) {
		fail(
			`${judgment.key}: justified extra must be rendered and categorized`,
		)
	}
	if (review.extraKind === 'feature_extra' && !review.approvalRef?.trim()) {
		fail(`${judgment.key}: extra feature requires an approval reference`)
	}
}

function checkCategory(judgment, review) {
	const { decision } = review
	if (!FINAL.has(decision) && !UNRESOLVED.has(decision))
		fail(`${judgment.key}: unknown review decision`)
	if (decision === 'same_element_exact') return checkExact(judgment, review)
	if (!review.reason?.trim())
		fail(`${judgment.key}: ${decision} needs a specific reason`)
	if (
		decision.startsWith('same_element_') &&
		(review.protoRef === 'introuvable' || review.usage === 'unused')
	) {
		fail(
			`${judgment.key}: same-element decision requires two rendered elements`,
		)
	}
	if (decision.startsWith('no_counterpart_'))
		checkNoCounterpart(judgment, review)
}

function reviewDecision(judgment, review) {
	checkEvidence(judgment, review)
	checkCategory(judgment, review)
	return {
		...review,
		key: judgment.key,
		app: judgment.app,
		candidate: judgment.candidate,
		choice: judgment.choice,
		confidence: judgment.confidence,
	}
}

function collectReviews(catalog, reviews) {
	if (
		!Array.isArray(catalog.results) ||
		catalog.results.length !== catalog.appKeys ||
		!Array.isArray(reviews)
	) {
		fail('incomplete catalog results or invalid review file')
	}
	const byKey = new Map()
	for (const review of reviews) {
		if (byKey.has(review.key)) fail(`duplicate reviewed key: ${review.key}`)
		byKey.set(review.key, review)
	}
	const known = new Set(catalog.results.map(judgment => judgment.key))
	for (const key of byKey.keys())
		if (!known.has(key)) fail(`review for unknown app key: ${key}`)
	return catalog.results.map(judgment => {
		const cached = judgment.source === 'approved_cache'
		if (cached && byKey.has(judgment.key))
			fail(`cached key reviewed again: ${judgment.key}`)
		const review = cached
			? judgment.approvedReview
			: byKey.get(judgment.key)
		if (!review) fail(`unreviewed app key: ${judgment.key}`)
		return reviewDecision(judgment, review)
	})
}

function removedDecisions(catalog, file) {
	const removed = catalog.removedKeys ?? []
	if (!removed.length && !file) return []
	if (!file)
		fail(
			`deleted keys need an explicit removal review: ${removed.join(', ')}`,
		)
	const decisions = loadJson(file)
	if (
		!Array.isArray(decisions) ||
		decisions.length !== removed.length ||
		decisions.some(
			entry => !removed.includes(entry.key) || !entry.reason?.trim(),
		) ||
		new Set(decisions.map(entry => entry.key)).size !== removed.length
	)
		fail(
			'removed review must cite every deleted key once, with UI-removal or replacement evidence',
		)
	return decisions
}

function fingerprintReviews(catalog, reviewed) {
	const { app, proto } = catalog.sourceRoots ?? {}
	if (!app || !proto || !catalog.snapshotHash)
		fail('catalog lacks source snapshot')
	const context = fingerprintSources(app, proto)
	if (context.snapshotHash !== catalog.snapshotHash)
		fail('source changed after prepare; rebuild catalog before closing')
	const prototype = prototypeCatalog(app, proto)
	return reviewed.map(review => {
		if (!FINAL.has(review.decision)) return review
		const fingerprint = fingerprintKey(
			context,
			{ key: review.key, ...review.app },
			review,
			prototype,
		)
		if (review.fingerprint && fingerprint !== review.fingerprint)
			fail(`${review.key}: cached source changed; review it again`)
		return { ...review, fingerprint }
	})
}

function options() {
	const [decisionsFile, reviewedFile, outFile, flag, removedFile] =
		process.argv.slice(ARGV_START)
	if (
		!decisionsFile ||
		!reviewedFile ||
		!outFile ||
		(flag && (flag !== '--removed' || !removedFile)) ||
		process.argv.length > ARGV_START + REQUIRED_ARGS + OPTIONAL_ARGS
	) {
		fail(
			'usage: catalog-close.mjs <catalog-decisions.json> <reviewed.json> <out.json> [--removed removed.json]',
		)
	}
	if (
		[decisionsFile, reviewedFile, removedFile].some(
			file => file && resolve(file) === resolve(outFile),
		)
	)
		fail('output must differ from review and decision inputs')
	return { decisionsFile, reviewedFile, outFile, removedFile }
}

function main() {
	const { decisionsFile, reviewedFile, outFile, removedFile } = options()
	const catalog = loadJson(decisionsFile)
	const reviewed = fingerprintReviews(
		catalog,
		collectReviews(catalog, loadJson(reviewedFile)),
	)
	const removed = removedDecisions(catalog, removedFile)
	const counts = Object.fromEntries(
		[...FINAL, ...UNRESOLVED].map(decision => [
			decision,
			reviewed.filter(entry => entry.decision === decision).length,
		]),
	)
	const unresolved = [...UNRESOLVED].reduce(
		(total, decision) => total + counts[decision],
		0,
	)
	const output = {
		fingerprintVersion: MAPPING_VERSION,
		appRevision: catalog.appRevision,
		protoRevision: catalog.protoRevision,
		count: reviewed.length,
		counts,
		unresolved,
		removed,
		reviewed,
	}
	writeFileSync(outFile, `${JSON.stringify(output, null, JSON_INDENT)}\n`)
	process.stderr.write(
		`reviewed ${reviewed.length} keys; approved-reused=${catalog.results.filter(entry => entry.source === 'approved_cache').length}; removed=${removed.length}; unresolved=${unresolved}; ${JSON.stringify(counts)}\n`,
	)
	if (unresolved) process.exitCode = 1
}

main()
