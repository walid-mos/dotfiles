import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { CONFIG_DIR_NAME, getAgentDir } from '@earendil-works/pi-coding-agent'

export type ActivationMode = 'always' | 'marker' | 'off'

export interface ContainerSandboxConfig {
	enabled: boolean
	activation: ActivationMode
	markerFile: string
	image: string
	containerName: string | null
	workdir: string
	mountCwd: boolean
	cpus: number
	memory: string
	env: Record<string, string>
	runArgs: string[]
	initArgs: string[]
}

// Container name `pi-<slug>-<hash>` budget: readable slug capped at 24 chars
// (= 63 - pi- prefix/hash/slashes), hash suffix keeps the last 6 FNV hex chars.
const CONTAINER_SLUG_MAX_CHARS = 24
const HASH_SUFFIX_CHARS = 6

export const DEFAULT_CONFIG: ContainerSandboxConfig = {
	enabled: true,
	activation: 'marker',
	markerFile: '.containerize',
	image: 'node:24',
	containerName: null,
	workdir: '/workspace',
	mountCwd: true,
	cpus: 2,
	memory: '2G',
	env: { COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' },
	runArgs: [],
	initArgs: ['sleep', 'infinity'],
}

export function loadConfig(cwd: string): ContainerSandboxConfig {
	const globalConfig = readJsonConfig(
		join(getAgentDir(), 'extensions', 'container-sandbox.json'),
	)
	const projectConfig = readJsonConfig(
		join(cwd, CONFIG_DIR_NAME, 'container.json'),
	)
	return mergeConfigs(
		mergeConfigs(DEFAULT_CONFIG, globalConfig),
		projectConfig,
	)
}

function readJsonConfig(path: string): Partial<ContainerSandboxConfig> {
	if (!existsSync(path)) return {}
	try {
		// Untrusted file boundary: JSON.parse returns any, only an assertion
		// narrows it; callers re-merge values defensively
		// oxlint-disable-next-line nextnode/no-type-assertion typescript/no-unsafe-type-assertion
		return JSON.parse(
			readFileSync(path, 'utf-8'),
		) as Partial<ContainerSandboxConfig>
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err)
		process.stderr.write(`Warning: could not parse ${path}: ${reason}\n`)
		return {}
	}
}

function mergeConfigs(
	base: ContainerSandboxConfig,
	overrides: Partial<ContainerSandboxConfig>,
): ContainerSandboxConfig {
	const merged: ContainerSandboxConfig = {
		...base,
		...stripUndefined(overrides),
	}
	if (overrides.env) merged.env = { ...base.env, ...overrides.env }
	return merged
}

function stripUndefined<T extends object>(configuration: T): Partial<T> {
	// Object.fromEntries loses precise keys; no property-based type survives
	// without an assertion, and `satisfies` cannot express Partial<T> here
	// oxlint-disable-next-line nextnode/no-type-assertion typescript/no-unsafe-type-assertion
	return Object.fromEntries(
		Object.entries(configuration).filter(
			([, configValue]) =>
				// Empty-string values are meaningful config (bare env vars); only
				// undefined keys drop, so identity beats truthiness here.
				// oxlint-disable-next-line nextnode/no-undefined-comparison
				configValue !== undefined,
		),
	) as Partial<T>
}

export function resolveContainerName(
	config: ContainerSandboxConfig,
	projectPath: string,
): string {
	if (config.containerName) return config.containerName
	const tailSegment = projectPath.split('/').findLast(Boolean) ?? 'project'
	const safeSlug = tailSegment
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, '-')
		.slice(0, CONTAINER_SLUG_MAX_CHARS)
	return `pi-${safeSlug}-${fnv1aHex(projectPath).slice(0, HASH_SUFFIX_CHARS)}`
}

export function resolveMountSource(
	config: ContainerSandboxConfig,
	projectPath: string,
): string | null {
	if (!config.mountCwd) return null
	return projectPath
}

// FNV-1a 32-bit parameters
const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193
const HEX_RADIX = 16
const HEX_HASH_WIDTH = 8

function fnv1aHex(input: string): string {
	let hash = FNV_OFFSET_BASIS
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i)
		hash = Math.imul(hash, FNV_PRIME) >>> 0
	}
	return hash.toString(HEX_RADIX).padStart(HEX_HASH_WIDTH, '0')
}
