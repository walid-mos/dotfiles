/**
 * Direct scopes: a natural target or explicit --files/--snapshot roots, with
 * no diff or Git dependency. Files under generated/dependency directories are
 * excluded before the manifest caps are applied.
 */

import { readdir, realpath } from 'node:fs/promises'
import path from 'node:path'

import { fileStats } from './git-files.ts'
import { ScopeError } from './git-shell.ts'
import { mapSequential } from './sequential.ts'

import type { Dirent } from 'node:fs'
import type { SelectedFile, ScopeSelection } from './git-files.ts'

const PARENT_PREFIX = '..'
const EXCLUDED_DIRECTORIES = new Set([
	'.git',
	'.next',
	'.nuxt',
	'.output',
	'.turbo',
	'build',
	'coverage',
	'dist',
	'node_modules',
	'target',
	'vendor',
])
const MATCH_LIMIT = 5

/** A bare target did not resolve literally; the agent may interpret it instead. */
export class TargetResolutionError extends ScopeError {}

export async function selectTarget(
	workspaceRoot: string,
	query: string,
	cwd: string,
): Promise<ScopeSelection> {
	const absolute = await resolveTarget(workspaceRoot, cwd, query)
	const relatives = await expandRoot(workspaceRoot, absolute)
	return selection(relatives, `the ${query} target`)
}

export async function selectSnapshot(
	workspaceRoot: string,
	paths: readonly string[],
	cwd: string,
): Promise<ScopeSelection> {
	const roots = await mapSequential(paths, raw =>
		resolveExisting(workspaceRoot, cwd, raw),
	)
	const groups = await mapSequential(roots, root =>
		expandRoot(workspaceRoot, root),
	)
	return selection(groups.flat(), `a direct scope of ${paths.length} root(s)`)
}

function selection(
	relatives: readonly string[],
	label: string,
): ScopeSelection {
	const changed = new Map<string, SelectedFile>()
	for (const relative of relatives)
		changed.set(relative, { status: 'modified', isWholeFile: true })
	if (!changed.size)
		throw new ScopeError(`${label} contains no readable files.`)
	return {
		label: `${label} (${changed.size} file(s))`,
		changed,
		dropped: [],
	}
}

async function resolveTarget(
	workspaceRoot: string,
	cwd: string,
	query: string,
): Promise<string> {
	const exact = await resolveCandidate(workspaceRoot, cwd, query)
	if (exact) return exact
	if (query.includes('/') || query.includes(path.sep))
		throw new TargetResolutionError(`The target "${query}" was not found.`)
	const matches = await findNamed(workspaceRoot, query)
	if (matches.length === 1 && matches[0]) return matches[0]
	if (!matches.length)
		throw new TargetResolutionError(
			`The target "${query}" did not match a file or directory in this workspace.`,
		)
	const shown = matches
		.slice(0, MATCH_LIMIT)
		.map(match => path.relative(workspaceRoot, match))
		.join(', ')
	throw new TargetResolutionError(
		`The target "${query}" is ambiguous: ${shown}. Use --files with the exact path.`,
	)
}

async function resolveExisting(
	workspaceRoot: string,
	cwd: string,
	raw: string,
): Promise<string> {
	const absolute = await resolveCandidate(workspaceRoot, cwd, raw)
	if (absolute) return absolute
	throw new ScopeError(`${raw} is not a readable file or directory.`)
}

async function resolveCandidate(
	workspaceRoot: string,
	cwd: string,
	raw: string,
): Promise<string | undefined> {
	const absolute = await resolved(path.resolve(cwd, raw))
	assertInside(workspaceRoot, absolute, raw)
	const stats = await fileStats(absolute)
	if (!stats?.isFile() && !stats?.isDirectory()) return undefined
	return absolute
}

async function expandRoot(
	workspaceRoot: string,
	absolute: string,
): Promise<string[]> {
	const stats = await fileStats(absolute)
	if (stats?.isFile()) return [path.relative(workspaceRoot, absolute)]
	if (!stats?.isDirectory()) return []
	return await walkDirectory(workspaceRoot, absolute)
}

async function walkDirectory(
	workspaceRoot: string,
	directory: string,
): Promise<string[]> {
	let entries
	try {
		entries = await readdir(directory, { withFileTypes: true })
	} catch {
		throw new ScopeError(`${directory} is not a readable directory.`)
	}
	const groups = await mapSequential(
		entries.toSorted((left, right) => left.name.localeCompare(right.name)),
		entry => expandEntry(workspaceRoot, directory, entry),
	)
	return groups.flat()
}

async function expandEntry(
	workspaceRoot: string,
	directory: string,
	entry: Dirent,
): Promise<string[]> {
	if (entry.isSymbolicLink()) return []
	const absolute = path.join(directory, entry.name)
	if (entry.isFile()) return [path.relative(workspaceRoot, absolute)]
	if (!entry.isDirectory() || EXCLUDED_DIRECTORIES.has(entry.name)) return []
	return await walkDirectory(workspaceRoot, absolute)
}

async function findNamed(
	workspaceRoot: string,
	query: string,
): Promise<string[]> {
	return await findNamedIn(workspaceRoot, query.toLocaleLowerCase())
}

async function findNamedIn(
	directory: string,
	normalizedQuery: string,
): Promise<string[]> {
	let entries
	try {
		entries = await readdir(directory, { withFileTypes: true })
	} catch {
		return []
	}
	const groups = await mapSequential(entries, entry =>
		findEntry(directory, entry, normalizedQuery),
	)
	return groups.flat()
}

async function findEntry(
	directory: string,
	entry: Dirent,
	normalizedQuery: string,
): Promise<string[]> {
	if (entry.isSymbolicLink()) return []
	const absolute = path.join(directory, entry.name)
	const matches =
		entry.name.toLocaleLowerCase() === normalizedQuery ? [absolute] : []
	if (!entry.isDirectory() || EXCLUDED_DIRECTORIES.has(entry.name))
		return matches
	return [...matches, ...(await findNamedIn(absolute, normalizedQuery))]
}

function assertInside(
	workspaceRoot: string,
	absolute: string,
	raw: string,
): void {
	const relative = path.relative(workspaceRoot, absolute)
	if (
		!relative ||
		relative.startsWith(PARENT_PREFIX) ||
		path.isAbsolute(relative)
	)
		throw new ScopeError(`${raw} is outside ${workspaceRoot}.`)
}

export async function resolveWorkspaceRoot(cwd: string): Promise<string> {
	return await resolved(cwd)
}

async function resolved(absolute: string): Promise<string> {
	try {
		return await realpath(absolute)
	} catch {
		try {
			const parent = await realpath(path.dirname(absolute))
			return path.join(parent, path.basename(absolute))
		} catch {
			return absolute
		}
	}
}
