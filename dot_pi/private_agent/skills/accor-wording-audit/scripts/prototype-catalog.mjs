import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { jsxCatalog } from './jsx-catalog.mjs'

const DICTIONARIES = [
	{ file: 'src/lib/backoffice-i18n.ts', symbol: 'BO_DICT' },
	{ file: 'src/lib/hotel-i18n.ts', symbol: 'TRANSLATIONS' },
]
const ROLE_FILE = 'src/lib/roles.ts'
const LOCALE_COUNT = 2

function exportedObject(ts, source, symbol) {
	const declaration = source.statements
		.filter(ts.isVariableStatement)
		.flatMap(statement =>
			Array.from(statement.declarationList.declarations),
		)
		.find(entry => entry.name.getText(source) === symbol)
	if (!declaration?.initializer)
		throw new Error(`${source.fileName}: missing ${symbol}`)
	return declaration.initializer
}

function unwrap(ts, node) {
	if (!(ts.isAsExpression(node) || ts.isParenthesizedExpression(node)))
		return node
	return unwrap(ts, node.expression)
}

function staticValue(ts, node, source, roles) {
	const entry = unwrap(ts, node)
	if (ts.isStringLiteral(entry) || ts.isNoSubstitutionTemplateLiteral(entry))
		return entry.text
	if (
		ts.isPropertyAccessExpression(entry) &&
		entry.expression.getText(source) === 'ROLE_LABELS'
	) {
		const role = roles[entry.name.text]
		if (!role)
			throw new Error(
				`${source.fileName}: unknown role ${entry.name.text}`,
			)
		return role
	}
	if (!ts.isObjectLiteralExpression(entry))
		throw new Error(`${source.fileName}: unresolved static value`)
	return Object.fromEntries(
		entry.properties.map(property => {
			if (!ts.isPropertyAssignment(property))
				throw new Error(
					`${source.fileName}: unsupported dictionary property`,
				)
			return [
				property.name.text,
				staticValue(ts, property.initializer, source, roles),
			]
		}),
	)
}

function localizedLeaf(context, entry) {
	const { ts } = context
	if (!ts.isObjectLiteralExpression(entry)) return null
	if (
		entry.properties.length !== LOCALE_COUNT ||
		!entry.properties.every(
			property =>
				ts.isPropertyAssignment(property) &&
				['fr', 'en'].includes(property.name.text),
		)
	)
		return null
	const translations = Object.fromEntries(
		entry.properties.map(property => [
			property.name.text,
			ts.isStringLiteral(property.initializer) ||
			ts.isNoSubstitutionTemplateLiteral(property.initializer)
				? property.initializer.text
				: null,
		]),
	)
	return {
		...translations,
		dynamic: translations.fr === null || translations.en === null,
	}
}

function collect(context, node, prefix, entries) {
	const { ts, source, file, symbol, roles } = context
	const entry = unwrap(ts, node)
	const line =
		source.getLineAndCharacterOfPosition(entry.getStart(source)).line + 1
	const ref = `${file}:${line}`
	const id = `${symbol}.${prefix}`
	if (ts.isPropertyAccessExpression(entry)) {
		entries.push({ id, ...staticValue(ts, entry, source, roles), ref })
		return
	}
	if (ts.isArrayLiteralExpression(entry)) {
		entry.elements.forEach((element, index) =>
			collect(context, element, `${prefix}[${index}]`, entries),
		)
		return
	}
	if (ts.isStringLiteral(entry)) {
		entries.push({ id, fr: null, en: null, ref, nonLocalized: entry.text })
		return
	}
	const leaf = localizedLeaf(context, entry)
	if (leaf) {
		entries.push({ id, ...leaf, ref })
		return
	}
	if (!ts.isObjectLiteralExpression(entry))
		throw new Error(
			`${source.fileName}:${line}: unresolved branch ${prefix}`,
		)
	for (const property of entry.properties) {
		if (!ts.isPropertyAssignment(property))
			throw new Error(
				`${source.fileName}:${line}: unsupported property ${prefix}`,
			)
		collect(
			context,
			property.initializer,
			prefix ? `${prefix}.${property.name.text}` : property.name.text,
			entries,
		)
	}
}

function parseDictionary(ts, protoRoot, definition, roles) {
	const { file, symbol } = definition
	const path = join(protoRoot, file)
	const source = ts.createSourceFile(
		path,
		readFileSync(path, 'utf8'),
		ts.ScriptTarget.Latest,
		true,
	)
	const entries = []
	collect(
		{ ts, source, file, symbol, roles },
		exportedObject(ts, source, symbol),
		'',
		entries,
	)
	return entries
}

export function prototypeCatalog(appRoot, protoRoot) {
	const requireFromApp = createRequire(join(appRoot, 'package.json'))
	const ts = requireFromApp('typescript')
	const path = join(protoRoot, ROLE_FILE)
	const source = ts.createSourceFile(
		path,
		readFileSync(path, 'utf8'),
		ts.ScriptTarget.Latest,
		true,
	)
	const roles = staticValue(
		ts,
		exportedObject(ts, source, 'ROLE_LABELS'),
		source,
		{},
	)
	return [
		...DICTIONARIES.flatMap(definition =>
			parseDictionary(ts, protoRoot, definition, roles),
		),
		...jsxCatalog(ts, protoRoot),
	]
}
