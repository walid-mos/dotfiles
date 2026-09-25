import { readFileSync } from 'node:fs'

const LOCALES = ['en', 'fr']
export const JUDGE_VERSION = 1 // Increment when the judgment contract changes.
const loadJson = file => JSON.parse(readFileSync(file, 'utf8'))
const fail = message => {
	throw new Error(message)
}

function catalogKeys(catalog, prefix = '') {
	if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
		fail(`invalid catalog at ${prefix || '<root>'}`)
	}
	return Object.entries(catalog).flatMap(([key, entry]) => {
		const path = prefix ? `${prefix}.${key}` : key
		return typeof entry === 'string' ? [path] : catalogKeys(entry, path)
	})
}

function forms(text, id) {
	if (typeof text === 'string') return new Map([['', text]])
	if (!text || typeof text !== 'object' || Array.isArray(text)) {
		fail(`${id}: expected a string or a plural-form object`)
	}
	const entries = Object.entries(text)
	if (
		!entries.length ||
		entries.some(([form, entry]) => !form || typeof entry !== 'string')
	) {
		fail(`${id}: invalid plural forms`)
	}
	return new Map(entries)
}

function validateLocale(row, locale) {
	const app = forms(row.appFinal?.[locale], `${row.key}/${locale} appFinal`)
	const proto = forms(
		row.protoFinal?.[locale],
		`${row.key}/${locale} protoFinal`,
	)
	if (
		app.size !== proto.size ||
		[...app.keys()].some(form => !proto.has(form))
	) {
		fail(
			`${row.key}/${locale}: plural forms differ between app and prototype`,
		)
	}
	for (const [form, text] of proto) {
		const noPair = row.protoRef === 'introuvable'
		if (noPair !== (text === '')) {
			fail(
				`${row.key}/${locale}/${form}: introuvable requires empty protoFinal, and vice versa`,
			)
		}
	}
}

function validateRow(row, expected, seen) {
	if (!row || typeof row.key !== 'string' || !expected.has(row.key)) {
		fail(`unknown or missing row key: ${row?.key}`)
	}
	if (seen.has(row.key)) fail(`duplicate row key: ${row.key}`)
	seen.add(row.key)
	if (typeof row.usage !== 'string' || !row.usage.trim())
		fail(`${row.key}: missing usage`)
	if (typeof row.protoRef !== 'string' || !row.protoRef.trim())
		fail(`${row.key}: missing prototype reference`)
	for (const locale of LOCALES) validateLocale(row, locale)
}

function validateRows(rows, fr, en, scope) {
	const frKeys = catalogKeys(fr)
	const enKeys = catalogKeys(en)
	const frSet = new Set(frKeys)
	const enSet = new Set(enKeys)
	if (
		frKeys.length !== enKeys.length ||
		frKeys.some(key => !enSet.has(key))
	) {
		fail(
			`FR/EN catalog key parity failed (FR ${frKeys.length}, EN ${enKeys.length})`,
		)
	}
	const expected = scope ?? frSet
	const missingScope = scope && [...scope].find(key => !frSet.has(key))
	if (missingScope) fail(`scope key missing from catalog: ${missingScope}`)
	const seen = new Set()
	for (const row of rows) validateRow(row, expected, seen)
	const missing = [...expected].filter(key => !seen.has(key))
	if (missing.length)
		fail(`missing ${missing.length} catalog rows: ${missing.join(', ')}`)
}

function flattenLocale(row, locale) {
	const app = forms(row.appFinal[locale], `${row.key}/${locale} appFinal`)
	const proto = forms(
		row.protoFinal[locale],
		`${row.key}/${locale} protoFinal`,
	)
	return [...app].map(([form, text]) => {
		const other = proto.get(form)
		const noPair = row.protoRef === 'introuvable'
		let verdict = 'differ'
		if (noPair) verdict = 'no-pair'
		else if (text === other) verdict = 'exact'
		return {
			id: `${row.key}#${form ? `${form}#` : ''}${locale}`,
			key: row.key,
			locale,
			form,
			app: text,
			proto: other,
			protoRef: row.protoRef,
			usage: row.usage,
			verdict,
			choice: null,
			confidence: null,
			flagged: noPair || verdict === 'differ',
			judgeVersion: JUDGE_VERSION,
		}
	})
}

function loadScope(file) {
	if (!file) return null
	const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)
	const scope = new Set(lines)
	if (!lines.length || scope.size !== lines.length)
		fail('scope file must contain unique, nonempty keys')
	return scope
}

export function loadRows(frFile, enFile, rowFiles, scopeFile) {
	const rows = rowFiles.flatMap(file => {
		const parsed = loadJson(file)
		if (!Array.isArray(parsed)) fail(`${file}: expected an array of rows`)
		return parsed
	})
	validateRows(rows, loadJson(frFile), loadJson(enFile), loadScope(scopeFile))
	return {
		rows,
		items: rows.flatMap(row =>
			LOCALES.flatMap(locale => flattenLocale(row, locale)),
		),
	}
}
