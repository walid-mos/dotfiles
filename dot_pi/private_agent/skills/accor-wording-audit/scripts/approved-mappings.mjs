import { readFileSync } from 'node:fs'

import { fingerprintKey, MAPPING_VERSION } from './mapping-footprint.mjs'
import { MissingSourceReference } from './mapping-source-index.mjs'

const APPROVED = new Set([
	'same_element_exact',
	'same_element_composition',
	'no_counterpart_justified',
])

function currentFingerprint(context, entry, review, prototype) {
	try {
		return fingerprintKey(context, entry, review, prototype)
	} catch (error) {
		if (error instanceof MissingSourceReference) return undefined
		throw error
	}
}

export function approvedMappings(file, context, app, prototype) {
	const report = JSON.parse(readFileSync(file, 'utf8'))
	if (
		report.fingerprintVersion !== MAPPING_VERSION ||
		!Array.isArray(report.reviewed)
	)
		throw new Error(
			'cache lacks source fingerprints; close a fresh review first',
		)
	const current = new Map(app.map(entry => [entry.key, entry]))
	const approved = new Map()
	const seen = new Set()
	let stale = 0
	for (const review of report.reviewed) {
		if (seen.has(review.key))
			throw new Error(`duplicate cached key: ${review.key}`)
		seen.add(review.key)
		if (!APPROVED.has(review.decision)) continue
		if (typeof review.fingerprint !== 'string')
			throw new Error(
				`${review.key}: approved mapping lacks a fingerprint`,
			)
		const entry = current.get(review.key)
		if (!entry) continue
		if (
			currentFingerprint(context, entry, review, prototype) !==
			review.fingerprint
		) {
			stale += 1
			continue
		}
		approved.set(entry.key, review)
	}
	return {
		approved,
		stale,
		removed: [...seen].filter(key => !current.has(key)).toSorted(),
	}
}
