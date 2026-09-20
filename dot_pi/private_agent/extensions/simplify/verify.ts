/**
 * The repository's own gates: the commands that prove a change did not break
 * anything. Detection only - the applier runs them through its own shell, never
 * from here. Gates come out cheapest-first.
 */

import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import { isRecord } from './json.ts'

import type { Gate } from './types.ts'

const MAX_GATES = 6
const DEFAULT_RUNNER = 'npm'

const SCRIPT_LABELS: Array<{ label: string; names: readonly string[] }> = [
	{ label: 'typecheck', names: ['typecheck', 'type-check'] },
	{ label: 'lint', names: ['lint'] },
	{ label: 'build', names: ['build'] },
	{ label: 'test', names: ['test'] },
]

const LOCKFILE_RUNNERS: ReadonlyArray<readonly [string, string]> = [
	['pnpm-lock.yaml', 'pnpm'],
	['bun.lockb', 'bun'],
	['bun.lock', 'bun'],
	['yarn.lock', 'yarn'],
	['package-lock.json', 'npm'],
]

const MAKEFILE_RUNNERS: ReadonlyArray<readonly [string, string]> = [
	['Makefile', 'make'],
	['justfile', 'just'],
]

const KNOWN_TARGETS = new Set([
	'typecheck',
	'type-check',
	'check',
	'lint',
	'build',
	'test',
])
const TARGET_LINE = /^([A-Za-z0-9][\w.-]*)\s*:(?!=)/u
const TEST_TARGET = 'test'

export async function detectGates(repoRoot: string): Promise<Gate[]> {
	const gates = [
		...(await packageGates(repoRoot)),
		...(await cargoGates(repoRoot)),
		...(await goGates(repoRoot)),
		...(await makefileGates(repoRoot)),
		...(await pythonGates(repoRoot)),
	]
	return dedupe(gates).slice(0, MAX_GATES)
}

async function packageGates(repoRoot: string): Promise<Gate[]> {
	const text = await readText(path.join(repoRoot, 'package.json'))
	if (!text) return []
	const scripts = scriptNames(text)
	if (!scripts) return []
	const runner = await packageRunner(repoRoot)
	return SCRIPT_LABELS.flatMap(({ label, names }) => {
		const name = names.find(candidate => scripts.has(candidate))
		return name ? [scriptGate(label, runner, name)] : []
	})
}

function scriptGate(label: string, runner: string, name: string): Gate {
	const gate: Gate = { label, command: `${runner} run ${name}` }
	if (label === TEST_TARGET) gate.long = true
	return gate
}

function scriptNames(text: string): Set<string> | undefined {
	try {
		const parsed: unknown = JSON.parse(text)
		if (!isRecord(parsed)) return undefined
		const { scripts } = parsed
		if (!isRecord(scripts)) return undefined
		return new Set(Object.keys(scripts))
	} catch {
		return undefined
	}
}

async function packageRunner(repoRoot: string): Promise<string> {
	const present = await Promise.all(
		LOCKFILE_RUNNERS.map(async ([lockfile, runner]) =>
			(await exists(path.join(repoRoot, lockfile))) ? runner : '',
		),
	)
	return present.find(runner => runner.length > 0) ?? DEFAULT_RUNNER
}

async function cargoGates(repoRoot: string): Promise<Gate[]> {
	if (!(await exists(path.join(repoRoot, 'Cargo.toml')))) return []
	return [
		{ label: 'cargo check', command: 'cargo check --all-targets' },
		{ label: 'cargo clippy', command: 'cargo clippy --all-targets' },
		{ label: 'cargo test', command: 'cargo test', long: true },
	]
}

async function goGates(repoRoot: string): Promise<Gate[]> {
	if (!(await exists(path.join(repoRoot, 'go.mod')))) return []
	return [
		{ label: 'go build', command: 'go build ./...' },
		{ label: 'go test', command: 'go test ./...', long: true },
	]
}

async function makefileGates(repoRoot: string): Promise<Gate[]> {
	const sources = await Promise.all(
		MAKEFILE_RUNNERS.map(async ([file, runner]) => ({
			runner,
			text: await readText(path.join(repoRoot, file)),
		})),
	)
	return sources.flatMap(source =>
		source.text ? targetGates(source.runner, source.text) : [],
	)
}

function targetGates(runner: string, text: string): Gate[] {
	return targets(text).map(target => {
		const gate: Gate = {
			label: `${runner} ${target}`,
			command: `${runner} ${target}`,
		}
		if (target === TEST_TARGET) gate.long = true
		return gate
	})
}

function targets(text: string): string[] {
	const found: string[] = []
	for (const line of text.split('\n')) {
		const name = TARGET_LINE.exec(line)?.[1]
		if (!name || !KNOWN_TARGETS.has(name)) continue
		if (name === 'check' && found.includes('typecheck')) continue
		found.push(name)
	}
	return found
}

async function pythonGates(repoRoot: string): Promise<Gate[]> {
	const text = await readText(path.join(repoRoot, 'pyproject.toml'))
	if (!text) return []
	const gates: Gate[] = []
	if (text.includes('[tool.ruff'))
		gates.push({ label: 'ruff', command: 'ruff check .' })
	if (text.includes('[tool.mypy'))
		gates.push({ label: 'mypy', command: 'mypy .' })
	if (text.includes('[tool.pytest'))
		gates.push({ label: 'pytest', command: 'pytest', long: true })
	return gates
}

function dedupe(gates: readonly Gate[]): Gate[] {
	const seen = new Set<string>()
	const kept: Gate[] = []
	for (const gate of gates) {
		if (seen.has(gate.command)) continue
		seen.add(gate.command)
		kept.push(gate)
	}
	return kept
}

async function readText(file: string): Promise<string | undefined> {
	try {
		return await readFile(file, 'utf8')
	} catch {
		return undefined
	}
}

async function exists(file: string): Promise<boolean> {
	try {
		await stat(file)
		return true
	} catch {
		return false
	}
}
