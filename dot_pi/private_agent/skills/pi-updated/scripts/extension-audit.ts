/** Extension-API audit: verify every pi.on event, registration call and
 * ctx.ui call used under extensions/ still exists in the installed pi
 * package's declarations. Run from ~/.pi/agent:
 *   node skills/pi-updated/scripts/extension-audit.ts
 * Name-level only - semantic drift (dispatch order, listener timing) is the
 * changelog review's job (see SKILL.md). */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { findPackage } from './lib-pi-package.ts'
import { sourceFiles, vendoredRoots } from './lib-vendored-packages.ts'

const AGENT_ROOT = process.cwd()
const EXTENSIONS_DIR = 'extensions'
const TYPES_ENTRY = 'dist/core/extensions/types.d.ts'

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

/** Method names declared in one `export interface <Name> { … }` block. */
function interfaceMethods(source: string, interfaceName: string): Set<string> {
	const start = source.indexOf(`export interface ${interfaceName} {`)
	if (start === -1) return new Set()
	const body = source.slice(
		start + `export interface ${interfaceName} {`.length,
	)
	let depth = 1
	let end = 0
	for (let index = 0; index < body.length; index++) {
		const character = body[index]
		if (character === '{') depth++
		if (character === '}') depth--
		if (depth === 0) {
			end = index
			break
		}
	}
	const block = body.slice(0, end)
	const methods = new Set<string>()
	for (const match of block.matchAll(/^\s{4}([a-zA-Z_$][\w$]*)[<(\s]/gm))
		methods.add(match[1] ?? '')
	return methods
}

/** `on(event: "NAME"` declarations anywhere in the source (they live on ExtensionAPI). */
function EventNames(source: string): Set<string> {
	const events = new Set<string>()
	for (const match of source.matchAll(/on\(event:\s*"([a-z_]+)"/g))
		events.add(match[1] ?? '')
	return events
}

interface Usage {
	eventNames: Map<string, string[]>
	apiMethods: Map<string, string[]>
	uiMethods: Map<string, string[]>
}

function record(map: Map<string, string[]>, name: string, file: string): void {
	const sites = map.get(name) ?? []
	sites.push(file)
	map.set(name, sites)
}

function collectUsage(): Usage {
	const usage: Usage = {
		eventNames: new Map(),
		apiMethods: new Map(),
		uiMethods: new Map(),
	}
	const scan = (source: string, file: string): void => {
		for (const match of source.matchAll(/\bpi\.on\(\s*['"]([a-z_]+)['"]/g))
			record(usage.eventNames, match[1] ?? '', file)
		for (const match of source.matchAll(/\bpi\.([a-zA-Z_$][\w$]*)\(/g))
			if ((match[1] ?? '') !== 'on')
				record(usage.apiMethods, match[1] ?? '', file)
		for (const match of source.matchAll(
			/\b(?:ctx|context)\.ui\.([a-zA-Z_$][\w$]*)\(/g,
		))
			record(usage.uiMethods, match[1] ?? '', file)
	}
	const roots = [
		join(AGENT_ROOT, EXTENSIONS_DIR),
		...vendoredRoots(AGENT_ROOT),
	]
	for (const file of roots.flatMap(sourceFiles))
		scan(readFileSync(file, 'utf8'), file)
	return usage
}

async function main(): Promise<number> {
	const root = findPackage()
	const typesPath = join(root, TYPES_ENTRY)
	if (!existsSync(typesPath)) throw new Error(`no ${TYPES_ENTRY} in ${root}`)
	const types = readFileSync(typesPath, 'utf8')
	const events = EventNames(types)
	const apiMethods = interfaceMethods(types, 'ExtensionAPI')
	const uiMethods = interfaceMethods(types, 'ExtensionUIContext')
	process.stdout.write(`types: ${typesPath}\n`)

	const usage = collectUsage()
	const report = newReport()
	const relPath = (file: string): string => file.replace(`${AGENT_ROOT}/`, '')

	for (const [name, files] of [...usage.eventNames].toSorted(([a], [b]) =>
		a.localeCompare(b),
	)) {
		const present = events.has(name)
		report.check(
			`pi.on('${name}')${present ? '' : ` - used in ${files.map(relPath).join(', ')}`}`,
			present,
		)
	}
	for (const [name, files] of [...usage.apiMethods].toSorted(([a], [b]) =>
		a.localeCompare(b),
	)) {
		const present = apiMethods.has(name)
		report.check(
			`pi.${name}()${present ? '' : ` - used in ${files.map(relPath).join(', ')}`}`,
			present,
		)
	}
	for (const [name, files] of [...usage.uiMethods].toSorted(([a], [b]) =>
		a.localeCompare(b),
	)) {
		const present = uiMethods.has(name)
		report.check(
			`ctx.ui.${name}()${present ? '' : ` - used in ${files.map(relPath).join(', ')}`}`,
			present,
		)
	}

	if (report.failures.length > 0) {
		reportLine(
			`\n${report.failures.length} call(s) missing - re-audit the affected extensions.`,
		)
		return 1
	}
	reportLine('\nextension API intact.')
	return 0
}

process.exitCode = await main()
