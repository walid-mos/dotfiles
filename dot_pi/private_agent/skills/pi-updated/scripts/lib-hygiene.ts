/** Shared support for the pi-updated hygiene scripts: JSON parsing without
 * assertions (the house lint forbids `as`), single-line reporting, and the
 * shapes flowing between the modules. */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function reportLine(line: string): void {
	process.stdout.write(`${line}\n`)
}

export function parseJson<T>(text: string): T {
	return JSON.parse(text) satisfies T
}

export function readJson<T>(path: string): T {
	return parseJson(readFileSync(path, 'utf8'))
}

export function readUtf8(path: string): string {
	return readFileSync(path, 'utf8')
}

export interface AgentSettings {
	packages?: string[]
	extensions?: string[]
}

export function readAgentSettings(agentDirectory: string): AgentSettings {
	return readJson<AgentSettings>(join(agentDirectory, 'settings.json'))
}

export interface LoadedPackage {
	entry: string
	root: string
	manifestName: string
}

export interface ManifestExtensions {
	pi?: { extensions?: string[] }
}

export interface RegisteredNames {
	commands: Set<string>
	tools: Set<string>
	flags: Set<string>
}

/** Extension load result produced by pi's own loader. */
export interface LoadedExtensions {
	extensions: Array<{ commands?: Map<string, unknown> }>
	errors: Array<{ path: string; error: string }>
	warnings?: Array<{ path: string; warning: string }>
}

export { existsSync }
