/** Class-level ABI audit for the private display adapters (raw-transcript, renderers).
 * Locates the installed pi bundle, greps the adapter sources for every reflected
 * runtime member, and checks each patched prototype method against the running
 * bundle. Run from ~/.pi/agent:
 *   node skills/pi-updated/scripts/abi-audit.ts
 * Keep COMPONENT_METHODS in sync with the *-surface.ts patch tables (see SKILL.md). */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { typedHost } from '#lib/ui/pi-members.ts'

import { findPackage } from './lib-pi-package.ts'

const AGENT_ROOT = process.cwd()
const ADAPTER_DIRS = ['extensions/lib/ui', 'extensions/ui/renderers']
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

function listSources(directory: string): string[] {
	if (!existsSync(directory)) return []
	return readdirSync(directory, { recursive: true, withFileTypes: true })
		.filter(entry => entry.isFile() && entry.name.endsWith('.ts'))
		.map(entry => join(entry.parentPath, entry.name))
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
	const bundle = join(findPackage(), BUNDLE_ENTRY)
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
