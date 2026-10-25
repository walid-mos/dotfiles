#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import {
	existsSync,
	globSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const MERMAID_CLI = '@mermaid-js/mermaid-cli@12.0.0'
const DOC_GLOBS = ['README.md', '**/AGENTS.md', 'docs/**/*.md']
const IGNORED_DIRS = new Set([
	'node_modules',
	'target',
	'dist',
	'build',
	'vendor',
	'.git',
])
const ERROR_LINES_SHOWN = 4
const EXIT_OK = 0
const EXIT_FAILED = 1
const EXIT_USAGE = 2
const STALE_PATTERNS = [
	[
		'value with a unit',
		/\b\d+(\.\d+)?\s?(ms|s|sec|seconds?|min|minutes?|h|hours?|days?|weeks?|[KMG]i?B|vCPU)\b/i,
	],
	['version', /\bv?\d+\.\d+\.\d+\b/],
	['date', /\b20\d\d-\d\d-\d\d\b/],
	['source path', /\b(src|crates|packages|apps|lib|internal|cmd)\/[\w./-]+/],
	[
		'source file',
		/\b[\w-]+\.(rs|ts|tsx|js|mjs|cjs|py|go|java|kt|swift|rb)\b/,
	],
	[
		'count',
		/\b\d+\s(files?|folders?|modules?|crates?|packages?|diagrams?|commands?|tests?)\b/i,
	],
	['state word', /\b(yet|today|currently|for now|at the moment|so far)\b/i],
]
const BROWSER_ROOTS = [
	process.env.PLAYWRIGHT_BROWSERS_PATH,
	join(homedir(), 'Library/Caches/ms-playwright'),
	join(homedir(), '.cache/ms-playwright'),
	'/opt/pw-browsers',
]
const BROWSER_GLOBS = [
	'chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell',
	'chromium-*/chrome-linux*/chrome',
	'chromium-*/chrome-mac*/*.app/Contents/MacOS/*',
]

function print(text) {
	process.stdout.write(`${text}\n`)
}

function usage() {
	process.stderr.write('usage: check-docs.mjs [--no-mermaid] <repository>\n')
	process.exit(EXIT_USAGE)
}

function options() {
	try {
		const { values, positionals } = parseArgs({
			allowPositionals: true,
			options: { 'no-mermaid': { type: 'boolean', default: false } },
		})
		if (positionals.length !== 1) return usage()
		return { repository: positionals[0], skipMermaid: values['no-mermaid'] }
	} catch {
		return usage()
	}
}

function docFiles(root) {
	const isIgnored = file =>
		file.split('/').some(part => IGNORED_DIRS.has(part))
	const files = DOC_GLOBS.flatMap(pattern => globSync(pattern, { cwd: root }))
	return [...new Set(files)].filter(file => !isIgnored(file)).toSorted()
}

function linesOf(text) {
	let fence = null
	return text.split('\n').map((line, index) => {
		const opening = line.match(/^\s*```(\w*)/)
		const inside = fence
		if (opening) fence = fence === null ? opening[1] || 'code' : null
		return { line, number: index + 1, fence: opening ? 'marker' : inside }
	})
}

function slug(heading) {
	return heading
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N} _-]/gu, '')
		.replaceAll(' ', '-')
}

function anchorsOf(file) {
	const headings = readFileSync(file, 'utf8').match(/^#+ .*$/gm) ?? []
	return new Set(headings.map(heading => slug(heading.replace(/^#+ /, ''))))
}

function brokenLinks(root, file) {
	const path = join(root, file)
	const prose = linesOf(readFileSync(path, 'utf8')).filter(
		entry => entry.fence === null,
	)
	return prose.flatMap(({ line, number }) =>
		[...line.matchAll(/\]\(([^)\s]+)\)/g)]
			.map(match => match[1])
			.filter(link => !/^[a-z]+:/i.test(link))
			.flatMap(link => {
				const [target, anchor] = link.split('#')
				const targetPath = target
					? resolve(dirname(path), target)
					: path
				if (!existsSync(targetPath))
					return [`${file}:${number}: missing ${link}`]
				const isMarkdown = targetPath.endsWith('.md')
				if (!anchor || !isMarkdown || anchorsOf(targetPath).has(anchor))
					return []
				return [
					`${file}:${number}: no heading for #${anchor} in ${target || file}`,
				]
			}),
	)
}

function staleCandidates(root, file) {
	const scanned = linesOf(readFileSync(join(root, file), 'utf8')).filter(
		entry => entry.fence === null || entry.fence === 'mermaid',
	)
	return scanned.flatMap(({ line, number }) =>
		STALE_PATTERNS.filter(([, pattern]) => pattern.test(line)).map(
			([label]) => `${file}:${number}: ${label}: ${line.trim()}`,
		),
	)
}

function findBrowser() {
	if (process.env.MERMAID_CHROME) return process.env.MERMAID_CHROME
	const roots = BROWSER_ROOTS.filter(root => root && existsSync(root))
	const found = roots.flatMap(root =>
		BROWSER_GLOBS.flatMap(pattern =>
			globSync(pattern, { cwd: root }).map(path => join(root, path)),
		),
	)
	return found.at(0)
}

function renderFailures(root, files, browser) {
	const workdir = mkdtempSync(join(tmpdir(), 'check-docs-'))
	const config = join(workdir, 'puppeteer.json')
	const headless = browser.includes('headless-shell') ? 'shell' : true
	writeFileSync(config, JSON.stringify({ executablePath: browser, headless }))
	const env = { ...process.env, PUPPETEER_SKIP_DOWNLOAD: '1' }
	const withDiagrams = files.filter(file =>
		readFileSync(join(root, file), 'utf8').includes('```mermaid'),
	)
	const failures = withDiagrams.flatMap(file => {
		const output = join(workdir, 'rendered.md')
		const args = [
			'--yes',
			'-p',
			MERMAID_CLI,
			'mmdc',
			'-q',
			'-p',
			config,
			'-i',
			join(root, file),
			'-o',
			output,
		]
		const render = spawnSync('npx', args, { encoding: 'utf8', env })
		if (render.status === EXIT_OK) return []
		const reason = `${render.stderr}${render.error?.message ?? ''}`
			.split('\n')
			.filter(line => line.trim() && !line.startsWith('npm '))
		return [`${file}: ${reason.slice(0, ERROR_LINES_SHOWN).join(' / ')}`]
	})
	rmSync(workdir, { recursive: true, force: true })
	return { failures, rendered: withDiagrams.length }
}

function report(title, lines) {
	print(`\n${title}: ${lines.length ? lines.length : 'ok'}`)
	for (const line of lines) print(`  ${line}`)
}

function checkMermaid(root, files) {
	const browser = findBrowser()
	if (!browser) {
		report('mermaid', [
			'no Chromium found: set MERMAID_CHROME, or pass --no-mermaid to skip',
		])
		return EXIT_FAILED
	}
	const { failures, rendered } = renderFailures(root, files, browser)
	report(`mermaid, files rendered ${rendered}`, failures)
	return failures.length
}

function main() {
	const { repository, skipMermaid } = options()
	const root = resolve(repository)
	const files = docFiles(root)
	print(`doc files checked under ${root}: ${files.length}`)
	const links = files.flatMap(file => brokenLinks(root, file))
	report('broken links', links)
	const mermaidErrors = skipMermaid ? 0 : checkMermaid(root, files)
	report(
		'stale candidates, to judge one by one (code examples are not scanned)',
		files.flatMap(file => staleCandidates(root, file)),
	)
	const errors = links.length + mermaidErrors
	process.exit(errors ? EXIT_FAILED : EXIT_OK)
}

main()
