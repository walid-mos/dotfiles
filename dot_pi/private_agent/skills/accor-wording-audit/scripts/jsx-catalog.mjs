import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const ATTRIBUTES = new Set(['aria-label', 'placeholder', 'title', 'alt'])
const MIN_VISIBLE_LENGTH = 2
const FR_CONDITION = /(?:lang|language|locale|\bL)\s*===?\s*['"]fr['"]/i

function sourceFiles(root) {
	return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
		const path = join(root, entry.name)
		if (entry.isDirectory()) return sourceFiles(path)
		return entry.isFile() && path.endsWith('.tsx') ? [path] : []
	})
}

function literal(ts, node) {
	if (!(ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)))
		return null
	return node.text
}

function visible(text) {
	return text?.trim().length >= MIN_VISIBLE_LENGTH && /\p{L}/u.test(text)
}

function visit(ts, source, add, node) {
	if (
		ts.isConditionalExpression(node) &&
		FR_CONDITION.test(node.condition.getText(source))
	) {
		add(
			node,
			literal(ts, node.whenTrue),
			literal(ts, node.whenFalse),
			'conditional',
		)
	}
	if (ts.isJsxText(node)) {
		const text = node.text.trim()
		add(node, text, text, 'jsx_text')
	}
	if (
		ts.isJsxAttribute(node) &&
		ATTRIBUTES.has(node.name.text) &&
		node.initializer
	) {
		const text = literal(ts, node.initializer)
		add(node, text, text, 'attribute')
	}
	ts.forEachChild(node, child => visit(ts, source, add, child))
}

function fileEntries(ts, root, path) {
	const source = ts.createSourceFile(
		path,
		readFileSync(path, 'utf8'),
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX,
	)
	const entries = []
	const file = relative(root, path)
	function add(node, fr, en, kind) {
		if (!visible(fr) || !visible(en)) return
		const line =
			source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
		const ref = `${file}:${line}`
		entries.push({
			id: `JSX.${file}:${line}:${entries.length}`,
			fr,
			en,
			ref,
			kind,
		})
	}
	visit(ts, source, add, source)
	return entries
}

export function jsxCatalog(ts, protoRoot) {
	const root = join(protoRoot, 'src')
	return sourceFiles(root).flatMap(path => fileEntries(ts, root, path))
}
