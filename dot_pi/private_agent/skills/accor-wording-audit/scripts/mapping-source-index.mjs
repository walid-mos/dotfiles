import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx']
const TEXT_EXTENSIONS = ['.json', '.css', '.html', '.svg']
const ALIAS_PREFIX_LENGTH = 2
const IGNORED = /\.(?:test|spec)\.[jt]sx?$/

export const digest = content =>
	createHash('sha256').update(content).digest('hex')
export const fileHash = file => digest(readFileSync(file))
export class MissingSourceReference extends Error {}

function collectFiles(root, extensions) {
	if (!existsSync(root)) return []
	const files = []
	function visit(directory) {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name)
			if (entry.isDirectory()) visit(path)
			else if (
				extensions.some(ext => path.endsWith(ext)) &&
				!IGNORED.test(path)
			)
				files.push(path)
		}
	}
	visit(root)
	return files.toSorted()
}

export const sourceFiles = root => collectFiles(root, EXTENSIONS)
export const textFiles = root => collectFiles(root, TEXT_EXTENSIONS)

function isDynamicTranslation(ts, node, source) {
	if (ts.isJsxAttribute(node) && node.name.text === 'i18nKey')
		return !node.initializer || !ts.isStringLiteral(node.initializer)
	if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
		return node.tagName.getText(source).split('.').at(-1) === 'Trans'
	if (
		!ts.isCallExpression(node) ||
		!/(?:^|\.)t$/.test(node.expression.getText(source))
	)
		return false
	const [first] = node.arguments
	return !first || !ts.isStringLiteralLike(first)
}

function parseSource(ts, file) {
	const content = readFileSync(file, 'utf8')
	const source = ts.createSourceFile(
		file,
		content,
		ts.ScriptTarget.Latest,
		true,
	)
	const strings = new Set()
	const identifiers = new Set()
	let isDynamic = false
	function visit(node) {
		if (ts.isStringLiteralLike(node)) strings.add(node.text)
		if (ts.isIdentifier(node)) identifiers.add(node.text)
		if (isDynamicTranslation(ts, node, source)) isDynamic = true
		ts.forEachChild(node, visit)
	}
	visit(source)
	const imports = source.statements
		.filter(
			statement =>
				(ts.isImportDeclaration(statement) ||
					ts.isExportDeclaration(statement)) &&
				statement.moduleSpecifier &&
				ts.isStringLiteral(statement.moduleSpecifier),
		)
		.map(statement => statement.moduleSpecifier.text)
	return {
		file,
		source,
		hash: digest(content),
		strings,
		identifiers,
		imports,
		isDynamic,
	}
}

export function sourceIndex(ts, root) {
	const entries = sourceFiles(join(root, 'src')).map(file =>
		parseSource(ts, file),
	)
	return new Map(entries.map(entry => [entry.file, entry]))
}

function importedFile(root, index, entry, specifier) {
	let target
	if (specifier.startsWith('@/'))
		target = join(root, 'src', specifier.slice(ALIAS_PREFIX_LENGTH))
	else if (specifier.startsWith('.'))
		target = resolve(dirname(entry.file), specifier)
	else return null
	const suffixes = [
		'',
		...EXTENSIONS,
		...EXTENSIONS.map(ext => `/index${ext}`),
	]
	for (const suffix of suffixes) {
		const file = `${target}${suffix}`
		if (index.has(file)) return file
	}
	return null
}

function importedFiles(root, index, entry) {
	return entry.imports
		.map(specifier => importedFile(root, index, entry, specifier))
		.filter(Boolean)
}

export function dependencies(root, index, startingFiles, isExcluded) {
	const selected = new Set()
	const pending = [...startingFiles]
	while (pending.length) {
		const file = pending.pop()
		if (selected.has(file) || isExcluded(file)) continue
		const entry = index.get(file)
		if (!entry)
			throw new MissingSourceReference(
				`source reference missing: ${file}`,
			)
		selected.add(file)
		pending.push(
			...importedFiles(root, index, entry).filter(
				imported => !selected.has(imported),
			),
		)
	}
	return [...selected]
		.toSorted()
		.map(file => [relative(root, file), index.get(file).hash])
}

export function citedFiles(root, citation) {
	const files = [
		...citation.matchAll(
			/(?:apps\/menu-compliance\/)?(?<app>src\/[\w./-]+\.[jt]sx?)|(?:^|[\s(])(?<proto>(?:components|pages|lib)\/[\w./-]+\.[jt]sx?)/g,
		),
	].map(match =>
		resolve(root, match.groups.app ?? `src/${match.groups.proto}`),
	)
	return new Set(files)
}

export function dictionaryLogic(ts, index) {
	return [...index.values()]
		.filter(entry =>
			/src\/lib\/(?:backoffice-i18n|hotel-i18n|roles)\.ts$/.test(
				entry.file,
			),
		)
		.map(entry => {
			const statements = entry.source.statements.filter(
				statement =>
					!ts.isVariableStatement(statement) ||
					!statement.declarationList.declarations.some(declaration =>
						['BO_DICT', 'TRANSLATIONS'].includes(
							declaration.name.getText(entry.source),
						),
					),
			)
			return [
				entry.file,
				digest(
					statements
						.map(statement => statement.getText(entry.source))
						.join('\n'),
				),
			]
		})
}
