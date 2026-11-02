import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

import { runProcess } from './lib-process.ts'
import { sha256Hex } from './lib-state.ts'

import type { FingerprintScope } from './lib-state.ts'

export type Fingerprint = {
	value: string
	manifest: readonly string[]
}

export type StatusEntry = {
	code: string
	path: string
}

const FINGERPRINT_LENGTH = 16
const GIT_TIMEOUT_MS = 60_000
const RENAME_CODES = new Set(['R', 'C'])
const STATUS_CODE_WIDTH = 2
const STATUS_PATH_OFFSET = 3
const FILE_MODE_MASK = 0o777
const OCTAL_RADIX = 8

function digestPath(path: string): string {
	const stats = statSync(path, { throwIfNoEntry: false })
	if (!stats) return 'absent'
	if (stats.isDirectory()) return 'directory'
	const mode = (stats.mode & FILE_MODE_MASK).toString(OCTAL_RADIX)
	return `${mode} ${sha256Hex(readFileSync(path))}`
}

export function gitOutput(
	repo: string,
	gitArguments: readonly string[],
): string | undefined {
	const outcome = runProcess({
		command: 'git',
		arguments: gitArguments,
		cwd: repo,
		timeoutMs: GIT_TIMEOUT_MS,
	})
	if (outcome.exitCode !== 0) return undefined
	return outcome.stdout
}

export function gitTopLevel(repo: string): string | undefined {
	return (
		gitOutput(repo, ['rev-parse', '--show-toplevel'])?.trim() || undefined
	)
}

export function gitHead(repo: string): string {
	return gitOutput(repo, ['rev-parse', 'HEAD'])?.trim() ?? 'none'
}

function isRenameCode(code: string): boolean {
	return [...code].some(letter => RENAME_CODES.has(letter))
}

export function gitStatusEntries(repo: string): StatusEntry[] {
	const status = gitOutput(repo, [
		'status',
		'--porcelain=v1',
		'-z',
		'--untracked-files=all',
	])
	if (!status) return []
	const entries: StatusEntry[] = []
	let renameCode: string | undefined
	for (const token of status.split('\0').filter(Boolean)) {
		if (renameCode) {
			entries.push({ code: renameCode, path: token })
			renameCode = undefined
			continue
		}
		const code = token.slice(0, STATUS_CODE_WIDTH)
		entries.push({ code, path: token.slice(STATUS_PATH_OFFSET) })
		renameCode = isRenameCode(code) ? code : undefined
	}
	return entries
}

function gitManifestLines(repo: string): string[] | undefined {
	const topLevel = gitTopLevel(repo)
	if (!topLevel) return undefined
	const fileLines = gitStatusEntries(repo).map(
		entry => `${digestPath(resolve(topLevel, entry.path))} ${entry.path}`,
	)
	return [`head ${gitHead(repo)}`, ...fileLines]
}

export function computeFingerprint(scope: FingerprintScope): Fingerprint {
	const gitLines = gitManifestLines(scope.repo)
	if (!gitLines && !scope.paths.length) {
		throw new Error(
			`${scope.repo} is not a git work tree; pass --path for every changed file so the fingerprint covers the reviewed material.`,
		)
	}
	const explicitLines = scope.paths.map(
		path => `file ${digestPath(resolve(path))} ${path}`,
	)
	const manifest = [...(gitLines ?? []), ...explicitLines].toSorted()
	return {
		value: sha256Hex(manifest.join('\n')).slice(0, FINGERPRINT_LENGTH),
		manifest,
	}
}
