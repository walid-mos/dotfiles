/** Project facts for the container-config fix: deterministic reads only. The
 * judgment (what the declaration should say) belongs to the session model;
 * this module only hands it the evidence - the repo's own manifests, dev
 * configs and env templates, plus the wt defaults a file may override. */

import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const FILE_CHARS = 4_000
const FACTS_BUDGET_CHARS = 16_000

export interface ProjectFacts {
	/** Source repo root, the directory .pi/container.json lives in. */
	repoRoot: string
	/** The declaration as the repo currently declares it, null when none. */
	current: string | null
	/** Everything else the model may judge from (bounded, joined). */
	evidence: string
	/** wt's global container defaults the file may override. */
	defaults: {
		image: string | null
		dns: string | null
		cpus: number | null
		memory: string | null
	}
}

/** The source repo behind `cwd` - the worktree's repo, not the worktree. */
export async function sourceRepoRoot(cwd: string): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync(
			'git',
			['rev-parse', '--path-format=absolute', '--git-common-dir'],
			{ cwd, timeout: 10_000 },
		)
		const commonDir = stdout.trim()
		if (!commonDir) return null
		return commonDir.replace(/\/\.git$/, '') || null
	} catch {
		return null
	}
}

/** True when wt will containerize a workspace spawned for this repo. */
export function containerizationActive(repoRoot: string): boolean {
	const defaults = wtContainerDefaults()
	if (defaults.activation === 'always') return true
	return (
		existsSync(join(repoRoot, '.containerize')) ||
		existsSync(join(repoRoot, '.pi', 'container.json'))
	)
}

/** wt's packaged default image, when the operator's global config names none: the
 * devvm image carries the toolchain the provisioning and relays expect (pnpm, git,
 * socat). The model must keep it unless the facts demand a different runtime. */
export const DEFAULT_WT_IMAGE = 'studio-dev:node24-pnpm11'
const DEFAULT_WT_DNS = '1.1.1.1'
const DEFAULT_WT_MEMORY = '2G'

function wtContainerDefaults(): {
	activation: string | null
	image: string | null
	dns: string | null
	cpus: number | null
	memory: string | null
} {
	const empty = {
		activation: null,
		image: null,
		dns: null,
		cpus: null,
		memory: null,
	}
	try {
		const parsed: unknown = JSON.parse(
			readText(join(homedir(), '.config', 'wt', 'config.json')) ?? '',
		)
		if (typeof parsed !== 'object' || parsed === null) return empty
		const container: unknown = Reflect.get(parsed, 'container')
		if (typeof container !== 'object' || container === null) return empty
		const cpus: unknown = Reflect.get(container, 'cpus')
		return {
			activation: stringOrNull(Reflect.get(container, 'activation')),
			image: stringOrNull(Reflect.get(container, 'image')) ?? DEFAULT_WT_IMAGE,
			dns: stringOrNull(Reflect.get(container, 'dns')) ?? DEFAULT_WT_DNS,
			cpus: typeof cpus === 'number' ? cpus : null,
			memory: stringOrNull(Reflect.get(container, 'memory')) ?? DEFAULT_WT_MEMORY,
		}
	} catch {
		return empty
	}
}

function stringOrNull(field: unknown): string | null {
	if (typeof field !== 'string') return null
	return field
}

function readText(path: string): string | null {
	if (!existsSync(path)) return null
	try {
		return readBounded(path)
	} catch {
		return null
	}
}

function readBounded(path: string): string {
	const text = readFileSync(path, 'utf-8')
	return text.length > FILE_CHARS ? `${text.slice(0, FILE_CHARS)}…` : text
}

/** Gather the evidence the model judges from; everything is best-effort. */
export function readProjectFacts(repoRoot: string): ProjectFacts {
	const defaults = wtContainerDefaults()
	const sections: string[] = []
	const push = (title: string, body: string | null): void => {
		if (body) sections.push(`<${title}>\n${body}\n</${title}>`)
	}
	push(
		'package.json',
		readText(join(repoRoot, 'package.json')),
	)
	push('pnpm-workspace.yaml', readText(join(repoRoot, 'pnpm-workspace.yaml')))
	push('docker-compose.yml', readText(join(repoRoot, 'docker-compose.yml')))
	push('env-example', readText(join(repoRoot, '.env.example')))
	push('readme-head', readText(join(repoRoot, 'README.md')))
	for (const name of devConfigNames()) {
		push(name, readText(join(repoRoot, name)))
	}
	const lockfiles = ['pnpm-lock.yaml', 'yarn.lock', 'package-lock.json'].filter(
		(name): name is string => existsSync(join(repoRoot, name)),
	)
	push('lockfiles', lockfiles.join('\n') || null)
	const current = readText(join(repoRoot, '.pi', 'container.json'))
	return {
		repoRoot,
		current,
		evidence: trimBudget(sections.join('\n')),
		defaults: {
			image: defaults.image,
			dns: defaults.dns,
			cpus: defaults.cpus,
			memory: defaults.memory,
		},
	}
}

function devConfigNames(): string[] {
	return [
		'vite.config.ts',
		'vite.config.js',
		'next.config.ts',
		'next.config.js',
		'next.config.mjs',
		'nuxt.config.ts',
		'svelte.config.js',
		'astro.config.mjs',
	]
}

function trimBudget(text: string): string {
	return text.length > FACTS_BUDGET_CHARS
		? `${text.slice(0, FACTS_BUDGET_CHARS)}…`
		: text
}
