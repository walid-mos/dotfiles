// node catalog-prepare.mjs <app-root> <prototype-root> <out.json> [--scope keys.txt] [--cache review-report.json]
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { approvedMappings } from './approved-mappings.mjs'
import { fingerprintSources } from './mapping-footprint.mjs'
import { prototypeCatalog } from './prototype-catalog.mjs'

const MAX_CANDIDATES = 8
const JSON_INDENT = 2
const ARGV_START = 2
const FLAG_STEP = 2
const KEY_WEIGHT = 3
const LOCALE_EXACT_WEIGHT = 12
const LANGUAGE_KEYS = ['fr', 'en']

const tokens = text =>
	new Set(
		text
			.replace(/([a-z])([A-Z])/g, '$1 $2')
			.toLocaleLowerCase()
			.match(/[\p{L}\p{N}]+/gu) ?? [],
	)
const overlap = (left, right) =>
	[...left].filter(token => right.has(token)).length
const revision = root =>
	execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
		encoding: 'utf8',
	}).trim()

function catalogPaths(catalog, prefix = '') {
	return Object.entries(catalog).flatMap(([key, entry]) => {
		const path = prefix ? `${prefix}.${key}` : key
		if (typeof entry === 'string') return [[path, entry]]
		if (entry && typeof entry === 'object' && !Array.isArray(entry))
			return catalogPaths(entry, path)
		throw new Error(`unexpected app catalog value: ${path}`)
	})
}

function appCatalog(appRoot) {
	const root = join(appRoot, 'src/shared/i18n/locales')
	const fr = catalogPaths(
		JSON.parse(readFileSync(join(root, 'fr.json'), 'utf8')),
	)
	const en = new Map(
		catalogPaths(JSON.parse(readFileSync(join(root, 'en.json'), 'utf8'))),
	)
	if (fr.length !== en.size || fr.some(([key]) => !en.has(key))) {
		throw new Error(
			`FR/EN key parity failed: fr=${fr.length} en=${en.size}`,
		)
	}
	return fr.map(([key, text]) => ({ key, fr: text, en: en.get(key) }))
}

function candidateScore(app, proto) {
	const keys = overlap(tokens(app.key), tokens(proto.id)) * KEY_WEIGHT
	const wording = LANGUAGE_KEYS.reduce((score, locale) => {
		const exact = app[locale] === proto[locale] ? LOCALE_EXACT_WEIGHT : 0
		return (
			score + exact + overlap(tokens(app[locale]), tokens(proto[locale]))
		)
	}, 0)
	return keys + wording
}

function pairCandidates(app, prototype) {
	const exact = prototype.filter(proto =>
		LANGUAGE_KEYS.every(locale => app[locale] === proto[locale]),
	)
	if (exact.length === 1) {
		return { ...app, status: 'exact_candidate', candidates: exact }
	}
	for (const locale of LANGUAGE_KEYS) {
		const matching = prototype.filter(
			proto => app[locale] === proto[locale],
		)
		if (matching.length === 1) {
			return { ...app, status: 'one_locale_match', candidates: matching }
		}
	}
	const ranked = prototype
		.map(proto => ({ proto, score: candidateScore(app, proto) }))
		.filter(entry => entry.score > 0)
		.toSorted(
			(left, right) =>
				right.score - left.score ||
				left.proto.id.localeCompare(right.proto.id),
		)
	const choices = ranked.slice(0, MAX_CANDIDATES).map(entry => entry.proto)
	return {
		...app,
		status: choices.length ? 'needs_jev' : 'no_candidate',
		candidates: choices,
	}
}

function scopedCatalog(catalog, file) {
	if (!file) return catalog
	const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)
	const selected = new Set(lines)
	if (!lines.length || selected.size !== lines.length)
		throw new Error('scope must contain unique, nonempty keys')
	const known = new Set(catalog.map(entry => entry.key))
	for (const key of selected)
		if (!known.has(key)) throw new Error(`unknown scope key: ${key}`)
	return catalog.filter(entry => selected.has(entry.key))
}

function options() {
	const [appRoot, protoRoot, output, ...flags] =
		process.argv.slice(ARGV_START)
	const selected = new Map()
	for (let index = 0; index < flags.length; index += FLAG_STEP) {
		const flag = flags[index]
		if (
			!['--scope', '--cache'].includes(flag) ||
			!flags[index + 1] ||
			selected.has(flag)
		)
			throw new Error(
				'usage: catalog-prepare.mjs <app-root> <prototype-root> <out.json> [--scope keys.txt] [--cache review-report.json]',
			)
		selected.set(flag, flags[index + 1])
	}
	if (!appRoot || !protoRoot || !output)
		throw new Error('app root, prototype root and output are required')
	if (
		[selected.get('--scope'), selected.get('--cache')].some(
			file => file && resolve(file) === resolve(output),
		)
	)
		throw new Error('output must differ from scope and cache inputs')
	return {
		appRoot: resolve(appRoot),
		protoRoot: resolve(protoRoot),
		output,
		scopeFile: selected.get('--scope'),
		cacheFile: selected.get('--cache'),
	}
}

function main() {
	const { appRoot, protoRoot, output, scopeFile, cacheFile } = options()
	const prototype = prototypeCatalog(appRoot, protoRoot)
	const literal = prototype.filter(
		entry => typeof entry.fr === 'string' && typeof entry.en === 'string',
	)
	const unresolved = prototype.filter(entry => !literal.includes(entry))
	const catalog = appCatalog(appRoot)
	const context = fingerprintSources(appRoot, protoRoot)
	const cache = cacheFile
		? approvedMappings(cacheFile, context, catalog, prototype)
		: { approved: new Map(), stale: 0, removed: [] }
	const app = scopedCatalog(catalog, scopeFile)
	const pairs = app.map(entry => {
		const approvedReview = cache.approved.get(entry.key)
		return approvedReview
			? { ...entry, status: 'approved_cache', approvedReview }
			: pairCandidates(entry, literal)
	})
	const payload = {
		sourceRoots: { app: appRoot, proto: protoRoot },
		snapshotHash: context.snapshotHash,
		removedKeys: cache.removed,
		appRevision: revision(appRoot),
		protoRevision: revision(protoRoot),
		appKeys: app.length,
		totalCatalogKeys: catalog.length,
		prototypeEntries: prototype.length,
		prototype,
		unresolved,
		pairs,
	}
	writeFileSync(output, `${JSON.stringify(payload, null, JSON_INDENT)}\n`)
	const reused = pairs.filter(pair => pair.status === 'approved_cache').length
	const exact = pairs.filter(pair => pair.status === 'exact_candidate').length
	const oneLocale = pairs.filter(
		pair => pair.status === 'one_locale_match',
	).length
	const needsJev = pairs.filter(pair => pair.status === 'needs_jev').length
	const noCandidates = pairs.filter(
		pair => pair.status === 'no_candidate',
	).length
	process.stderr.write(
		`prepared keys=${pairs.length} approved-reused=${reused} stale=${cache.stale} removed=${cache.removed.length} prototype=${prototype.length} unresolved=${unresolved.length} unique-exact=${exact} one-locale=${oneLocale} jev=${needsJev} no-candidates=${noCandidates}\n`,
	)
}

main()
