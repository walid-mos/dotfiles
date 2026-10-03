/** Hygiene audit for Pi extension packages, mirroring pi's own loader rules
 * from `dist/core/resource-loader.js` (HOST_PROVIDED_EXTENSION_PACKAGES +
 * collectExtensionPackageWarnings) and the replaceable-builtin shadowing the
 * loader resolves in omitReplacedExtensions. Builtins disabled through the
 * settings `extensions` array (`-builtin:<name>`) are excluded from the
 * collision check, matching what the running loader actually loads. Run
 * from ~/.pi/agent:
 *   node --experimental-transform-types skills/pi-updated/scripts/hygiene-audit.ts
 * Exit 1 when a finding exists; every finding line names the fix.
 * Limits: name-level static checks like the other pi-updated scripts; the
 * live loader pass covers the loader's own runtime warnings. */
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { readAgentSettings, readUtf8, reportLine } from './lib-hygiene.ts'
import {
	collectPackages,
	collectEntryNames,
	hostProvidedDependencies,
} from './lib-manifest-checks.ts'
import { findPackage } from './lib-pi-package.ts'

import type { LoadedExtensions, RegisteredNames } from './lib-hygiene.ts'

const RESOURCE_LOADER_PATH = 'dist/core/resource-loader.js'
const BUILTIN_INDEX_PATH = 'dist/extensions/index.js'
const BUNDLE_PATH = 'dist/bundle/index.js'
const BUILTIN_DEPTH = 'builtin:'.length

/** One collidable name per replaceable builtin, resolved from the import
 * lines of dist/extensions/index.js. The script fails loudly when the
 * running release gains a builtin missing here, so this map can never
 * silently miss a shadowing case. */
const COLLIDABLE_NAMES: Record<string, string> = {
	codemode: 'tool:codemode',
	'tool-search': 'tool:tool_search',
	mcp: 'command:mcp',
}

/** Host-provided package names, extracted from the running pi itself so the
 * list can never drift from the loader's own set. */
function extractHostProvided(resourceLoader: string): Set<string> {
	const source = readUtf8(resourceLoader)
	const block = source.match(
		/HOST_PROVIDED_EXTENSION_PACKAGES = new Set\(\[([\s\S]*?)\]\)/,
	)
	const namesBody = block?.[1]
	if (!namesBody)
		throw new Error(
			`HOST_PROVIDED_EXTENSION_PACKAGES missing in ${resourceLoader}; pi layout changed, re-audit this script.`,
		)
	const names = [...namesBody.matchAll(/"([^"]+)"/g)].map(
		match => match[1] ?? '',
	)
	if (!names.includes('typebox'))
		throw new Error(
			`typebox missing from the extracted host set; re-audit ${resourceLoader}.`,
		)
	return new Set(names)
}

/** Replaceable builtins from the running pi's index: name → collidable name.
 * Unknown names fail the audit instead of silently passing a new builtin. */
function extractBuiltins(builtinIndex: string): Map<string, string> {
	const names = [
		...readUtf8(builtinIndex).matchAll(
			/\{ name: "([^"]+)", factory: \w+, replaceable: true/g,
		),
	].map(match => match[1] ?? '')
	const collidables = new Map<string, string>()
	for (const name of names) {
		const collidable = COLLIDABLE_NAMES[name]
		if (!collidable)
			throw new Error(
				`new replaceable builtin "${name}" found in ${builtinIndex}; add it to COLLIDABLE_NAMES in this script.`,
			)
		collidables.set(name, collidable)
	}
	return collidables
}

/** Drop the builtins the settings exclude (`-builtin:<name>` entries), so the
 * collision check matches what the running loader actually loads. */
function applySettingsExclusions(
	builtins: Map<string, string>,
	baseDirectory: string,
): void {
	for (const entry of readAgentSettings(baseDirectory).extensions ?? []) {
		const excludedName = entry.match(/^-(builtin:.+)$/)?.[1]
		if (excludedName) builtins.delete(excludedName.slice(BUILTIN_DEPTH))
	}
}

/** A loaded extension must not register a name owned by a replaceable builtin. */
function checkBuiltinShadowing(
	builtins: Map<string, string>,
	namesByEntry: Map<string, RegisteredNames>,
	failures: string[],
): void {
	for (const [builtinName, collidableName] of builtins.entries()) {
		const [kind = '', name = ''] = collidableName.split(':')
		const holders = [...namesByEntry.entries()].filter(([, registered]) =>
			kind === 'command'
				? registered.commands.has(name)
				: registered.tools.has(name),
		)
		if (!holders.length) {
			reportLine(
				`✓ no loaded extension shadows builtin:${builtinName} (${collidableName})`,
			)
			continue
		}
		reportLine(
			`✗ builtin:${builtinName} is shadowed by extension ${holders.map(([n]) => n).join(', ')}`,
		)
		reportLine(`  registered ${collidableName} like builtin:${builtinName}`)
		reportLine(
			`  fix: disable the builtin with settings "extensions": ["-builtin:${builtinName}"], ` +
				`or remove/rename the registered "${name}" so pi's own builtin owns it`,
		)
		for (const [extensionName] of holders)
			failures.push(`builtin:${builtinName} shadowed by ${extensionName}`)
	}
}

/** Live phase: run pi's own loader over the real settings - the same path a
 * session start takes, builtins and `-builtin:<name>` toggles included - and
 * treat every loader warning or error as a finding. This catches what static
 * name scans cannot: dynamic registrations and loader-only rules. */
async function runLivePhase(
	bundlePath: string,
	baseDir: string,
	failures: string[],
): Promise<LoadedExtensions | undefined> {
	try {
		const runtime = await import(pathToFileURL(bundlePath).href)
		const settingsManager = runtime.SettingsManager.create(baseDir, baseDir)
		const loader = new runtime.DefaultResourceLoader({
			cwd: baseDir,
			agentDir: baseDir,
			settingsManager,
		})
		await loader.reload()
		return loader.getExtensions() satisfies LoadedExtensions
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : String(cause)
		failures.push('live loader pass threw')
		reportLine(`✗ live loader pass threw: ${message}`)
		return undefined
	}
}

/** One live-pass finding: fold its warnings and errors into the failures so
 * the session-start banner is proven clean, not assumed. */
function foldLiveFindings(
	live: LoadedExtensions,
	baseDir: string,
	failures: string[],
): void {
	reportLine(
		`live loader pass (${baseDir}): ${live.extensions.length} extensions, ` +
			`${live.errors.length} errors, ${live.warnings?.length ?? 0} warnings`,
	)
	for (const warning of live.warnings ?? []) {
		failures.push(`loader warning from ${warning.path}`)
		reportLine(`✗ loader warning (${warning.path}) -> ${warning.warning}`)
	}
	for (const error of live.errors ?? []) {
		failures.push(`loader error from ${error.path}`)
		reportLine(
			`✗ loader error (${error.path}) -> ${error.error.split('\n')[0]}`,
		)
	}
}

/** Static phase, in report order: title lines, package manifest scan, and
 * builtin-shadow scan. Findings accumulate in the passed array. Returns the
 * package root of the running pi for the live-phase bundle path. */
function staticAudit(baseDirectory: string, failures: string[]): string {
	const pkg = findPackage()
	const hostProvided = extractHostProvided(join(pkg, RESOURCE_LOADER_PATH))
	const builtins = extractBuiltins(join(pkg, BUILTIN_INDEX_PATH))
	applySettingsExclusions(builtins, baseDirectory)
	reportLine(`installed pi: ${pkg}`)
	reportLine(
		`host-provided set (${hostProvided.size}): ${[...hostProvided].toSorted().join(', ')}`,
	)
	reportLine(
		`builtins in scope after settings exclusions: ${[...builtins.keys()].join(', ') || '(none)'}`,
	)
	reportLine('')
	const packages = collectPackages(baseDirectory)
	if (!packages.length)
		reportLine('(no packages entries resolved from settings.json)')
	for (const loaded of packages) {
		if (hostProvidedDependencies(loaded, hostProvided).length)
			failures.push(
				`${loaded.manifestName}: host-provided package in dependencies`,
			)
	}
	const namesByEntry = new Map<string, RegisteredNames>()
	for (const loaded of packages)
		namesByEntry.set(loaded.manifestName, collectEntryNames(loaded))
	checkBuiltinShadowing(builtins, namesByEntry, failures)
	return pkg
}

function agentDirectory(): string {
	// <agent>/skills/pi-updated/scripts/hygiene-audit.ts → <agent>
	return dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
}

function exitWith(failures: string[]): never {
	reportLine(
		failures.length
			? `\n${failures.length} hygiene finding(s).`
			: '\nextension hygiene intact.',
	)
	process.exit(failures.length ? 1 : 0)
}

async function main(): Promise<void> {
	const baseDir = agentDirectory()
	const failures: string[] = []
	const pkg = staticAudit(baseDir, failures)
	if (failures.length) exitWith(failures)
	const live = await runLivePhase(join(pkg, BUNDLE_PATH), baseDir, failures)
	if (live) foldLiveFindings(live, baseDir, failures)
	exitWith(failures)
}

try {
	await main()
} catch (cause: unknown) {
	reportLine(
		`✗ hygiene-audit threw: ${cause instanceof Error ? cause.message : String(cause)}`,
	)
	process.exit(1)
}
