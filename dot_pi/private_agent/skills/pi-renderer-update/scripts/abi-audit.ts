/** Class-level ABI audit for the private display adapters (raw-transcript, renderers).
 * Locates the installed pi bundle, greps the adapter sources for every reflected
 * runtime member, and checks each patched prototype method against the running
 * bundle. Run from ~/.pi/agent:
 *   node --experimental-transform-types skills/pi-renderer-update/scripts/abi-audit.ts
 * Keep COMPONENT_METHODS in sync with the *-surface.ts patch tables (see SKILL.md). */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, realpathSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { typedHost } from '../../../extensions/ui/pi-members.ts'

const AGENT_ROOT = process.cwd()
const ADAPTER_DIRS = [
	'extensions/ui',
	'extensions/renderers',
	'extensions/raw-transcript',
]
const PACKAGE_NAME = '@earendil-works/pi-coding-agent'
const BUNDLE_ENTRY = 'dist/bundle/index.js'

/** Component class → prototype methods the adapters patch or invoke on the host itself. */
const COMPONENT_METHODS = {
	UserMessageComponent: ['rebuild', 'clear', 'addChild'],
	SkillInvocationMessageComponent: ['render', 'handleMouse'],
	InteractiveMode: ['addCustomEntryToChat'],
	ToolExecutionComponent: [
		'hasRendererDefinition',
		'getRenderShell',
		'updateDisplay',
		'render',
		'handleMouse',
	],
	AssistantMessageComponent: ['updateContent'],
	CompactionSummaryMessageComponent: ['invalidate'],
} satisfies Record<string, string[]>

interface Report {
	failures: string[]
	check(member: string, present: boolean): void
}

function reportLine(line: string): void {
	process.stdout.write(`${line}\n`)
}

function newReport(): Report {
	const failures: string[] = []
	return {
		failures,
		check(member, present) {
			reportLine(`${present ? '✓' : '✗'} ${member}`)
			if (!present) failures.push(member)
		},
	}
}

function isPackageRoot(directory: string): boolean {
	const manifestPath = join(directory, 'package.json')
	if (!existsSync(manifestPath)) return false
	const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
	return (
		typeof manifest === 'object' &&
		manifest !== null &&
		'name' in manifest &&
		manifest.name === PACKAGE_NAME
	)
}

/** Package root for a known CLI entry path, or undefined when none sits above it. */
function packageRoot(entry: string): string | undefined {
	let directory = dirname(realpathSync(entry))
	while (dirname(directory) !== directory) {
		if (isPackageRoot(directory)) return directory
		directory = dirname(directory)
	}
	return undefined
}

/** The CLI entry a launcher shim execs, with `$basedir` resolved to the shim directory;
 * the Windows variant (`$basedir_win`) lines are skipped. */
function shimCliTarget(shim: string): string | undefined {
	const matches = readFileSync(shim, 'utf8').matchAll(
		/([^"\s]*)@earendil-works\/pi-coding-agent\/dist\/bundle\/cli\.js/g,
	)
	for (const match of matches) {
		const prefix = match[1] ?? ''
		if (prefix.includes('$basedir_win')) continue
		const target = resolve(
			dirname(shim),
			prefix.replaceAll('$basedir', dirname(shim)) +
				match[0].slice(prefix.length),
		)
		if (existsSync(target)) return target
	}
	return undefined
}

/** Resolve the installed CLI bundle from the `pi` binary on PATH: a launcher
 * shim names its target, a symlinked bin sits inside the package itself. */
function findBundle(): string {
	const binary = execFileSync('which', ['pi'], { encoding: 'utf8' }).trim()
	const root = packageRoot(binary) ?? packageRoot(shimCliTarget(binary) ?? '')
	if (!root)
		throw new Error(`no ${PACKAGE_NAME} package found above ${binary}`)
	return join(root, BUNDLE_ENTRY)
}

function listSources(directory: string): string[] {
	return readdirSync(directory, { recursive: true, withFileTypes: true })
		.filter(entry => entry.isFile() && entry.name.endsWith('.ts'))
		.map(entry => join(entry.parentPath ?? entry.path, entry.name))
}

/** Reflected runtime members, derived from the adapter sources themselves. */
function collectMembers(source: string, members: Set<string>): void {
	for (const match of source.matchAll(
		/reflectMember\((?:runtime|classes),\s*'(\w+)'/g,
	))
		members.add(match[1] ?? '')
}

function reflectedMembers(): Set<string> {
	const members = new Set<string>()
	for (const directory of ADAPTER_DIRS)
		for (const file of listSources(join(AGENT_ROOT, directory)))
			collectMembers(readFileSync(file, 'utf8'), members)
	members.delete('')
	return members
}

async function main(): Promise<number> {
	const bundle = findBundle()
	const runtime = typedHost(await import(pathToFileURL(bundle).href))
	if (!runtime) throw new Error('pi bundle module is not object-like')
	const report = newReport()
	reportLine(`bundle: ${bundle}`)

	const version = Reflect.get(runtime, 'VERSION')
	reportLine(`installed pi: ${String(version)}`)

	for (const member of [...reflectedMembers()].toSorted())
		report.check(`runtime export ${member}`, Reflect.has(runtime, member))

	for (const [className, methods] of Object.entries(COMPONENT_METHODS)) {
		const component = typedHost(Reflect.get(runtime, className))
		const prototype =
			typeof component === 'function'
				? typedHost(Reflect.get(component, 'prototype'))
				: undefined
		report.check(`component ${className}`, Boolean(prototype))
		if (!prototype) continue
		for (const method of methods)
			report.check(
				`${className}.${method}`,
				typeof Reflect.get(prototype, method) === 'function',
			)
	}

	if (report.failures.length > 0) {
		reportLine(
			`\n${report.failures.length} member(s) missing - re-audit the adapters.`,
		)
		return 1
	}
	reportLine('\nclass-level ABI intact.')
	return 0
}

process.exitCode = await main()
