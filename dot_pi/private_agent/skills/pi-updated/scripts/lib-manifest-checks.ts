/** Manifest and registration checks for the packages pi's settings load:
 * package resolution (mirroring pi's own rules), host-provided dependency
 * scan, and static command/tool/flag name extraction from extension entries. */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { readJson, reportLine } from './lib-hygiene.ts'

import type {
	LoadedPackage,
	ManifestExtensions,
	RegisteredNames,
} from './lib-hygiene.ts'

/** Manifest path of one settings `packages` entry, resolved exactly like pi:
 * `npm:<name>[@range]` below the agent npm dir, other paths relative to the
 * agent directory. */
export function manifestForEntry(
	agentDirectory: string,
	rawEntry: string,
): string | undefined {
	if (rawEntry.match(/^npm:[@a-z][-/@\w]*(@[^\s]+)?$/)) {
		const name = rawEntry.slice('npm:'.length).replace(/@[^@]*$/, '')
		return join(agentDirectory, 'npm', 'node_modules', name, 'package.json')
	}
	const manifestPath = join(
		resolve(agentDirectory, rawEntry.replace(/^file:/, '')),
		'package.json',
	)
	if (existsSync(manifestPath)) return manifestPath
	return undefined
}

export function collectPackages(agentDirectory: string): LoadedPackage[] {
	const settings = readJson<{ packages?: string[] }>(
		join(agentDirectory, 'settings.json'),
	)
	const loaded: LoadedPackage[] = []
	for (const rawEntry of settings.packages ?? []) {
		const manifestPath = manifestForEntry(agentDirectory, rawEntry)
		if (!manifestPath || !existsSync(manifestPath)) {
			reportLine(`? ${rawEntry}: no package.json resolved; skipping`)
			continue
		}
		const manifest = readJson<{ name?: string }>(manifestPath)
		const manifestName = manifest.name ?? '(unnamed)'
		loaded.push({
			entry: rawEntry,
			root: dirname(manifestPath),
			manifestName,
		})
	}
	return loaded
}

/** The loaded manifest keeps the host-provided set out of dependencies:
 * violations are reported with their fix and returned. */
export function hostProvidedDependencies(
	ofPackage: LoadedPackage,
	hostProvided: Set<string>,
): string[] {
	const manifestPath = join(ofPackage.root, 'package.json')
	const manifest = readJson<{ dependencies?: Record<string, string> }>(
		manifestPath,
	)
	const hostDeps = Object.keys(manifest.dependencies ?? {})
		.filter(name => hostProvided.has(name))
		.toSorted()
	if (hostDeps.length) {
		reportLine(`✗ package ${ofPackage.manifestName} (${manifestPath})`)
		const fix =
			`declare it in peerDependencies with a "*" range (peerDependenciesMeta optional:true ` +
			`for runtime-optional use), remove it from dependencies, and keep a pinned copy in ` +
			`devDependencies for local builds`
		for (const dep of hostDeps)
			reportLine(`  host-provided in dependencies: ${dep} (fix: ${fix})`)
	} else {
		reportLine(
			`✓ package ${ofPackage.manifestName} (${manifestPath}): no host-provided package in dependencies`,
		)
	}
	return hostDeps
}

/** Extension entry files of a package minus build output, for static name scans. */
function entrySources(packageDirectory: string): string[] {
	const manifest = readJson<ManifestExtensions>(
		join(packageDirectory, 'package.json'),
	)
	const sources: string[] = []
	for (const entry of manifest.pi?.extensions ?? []) {
		const path = resolve(packageDirectory, entry.replace('./', ''))
		if (!existsSync(path)) continue
		if (path.endsWith('.ts') || path.endsWith('.js')) {
			sources.push(path)
			continue
		}
		collectSourceFiles(path, sources)
	}
	return sources
}

function collectSourceFiles(directory: string, sources: string[]): void {
	for (const dirent of readdirSync(directory, {
		recursive: true,
		withFileTypes: true,
	})) {
		if (!dirent.isFile()) continue
		if (
			!/\.(ts|js)$/.test(dirent.name) ||
			/\.(test|spec)\./.test(dirent.name)
		)
			continue
		sources.push(join(dirent.parentPath ?? dirent.path, dirent.name))
	}
}

function registeredNames(source: string, into: RegisteredNames): void {
	for (const match of source.matchAll(
		/registerCommand\(\s*["'`]([^"'`.\n]+)["'`]/g,
	))
		into.commands.add(match[1] ?? '')
	for (const match of source.matchAll(
		/registerFlag\(\s*["'`]([^"'`\n]+)["'`]/g,
	))
		into.flags.add(match[1] ?? '')
	for (const match of source.matchAll(
		/registerTool\(\s*[({][\s\S]{0,200}?name:\s*["'`]([a-zA-Z][\w-]*)["'`]/g,
	))
		into.tools.add(match[1] ?? '')
}

/** Static command/tool/flag names every loaded package's extensions register. */
export function collectEntryNames(ofPackage: LoadedPackage): RegisteredNames {
	const names: RegisteredNames = {
		commands: new Set(),
		tools: new Set(),
		flags: new Set(),
	}
	for (const source of entrySources(ofPackage.root))
		registeredNames(readFileSync(source, 'utf8'), names)
	return names
}
