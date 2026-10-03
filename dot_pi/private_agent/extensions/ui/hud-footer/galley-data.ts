// Live Galley review desk discovery. Galley tracks running desks on disk as
// `~/.galley/<repo-hash>/<session>/desk.lock`; this module mirrors that read
// contract for the footer. Strictly read-only: a dead-pid lock is debris the
// desk itself sweeps on its next own read, never the footer.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { isRecord } from './json.ts'

const execFileAsync = promisify(execFile)

/** Repo-root resolution budget: a hung git degrades to no link, not a hang. */
const ROOT_TIMEOUT_MS = 5000

const GALLEY_DIR = '.galley'
const DESK_LOCK_FILE = 'desk.lock'
// Galley keys per-repo review dirs by sha256(gitRoot), first 16 hex chars.
// Byte-for-byte on purpose: the footer reads the dirs galley writes.
const HASH_SPAN = 16

/** One running review desk, addressed by the URL the agent subcommands use. */
export type GalleyDesk = { session: string; url: string }

export type DeskLock = GalleyDesk & { pid: number; startedAt: number }

/** desk lock keyed under ~/.galley/<hash(root)> - mirrors galley identity.hash. */
export function deskDirHash(root: string): string {
	return createHash('sha256').update(root).digest('hex').slice(0, HASH_SPAN)
}

/**
 * Galley's resolveRoot: the git toplevel, falling back to the absolute cwd for
 * non-repo desks (`galley file` still serves outside a repo). The exact string
 * is hashed, so mirror the command and trimming of galley's git() wrapper.
 */
export async function resolveDeskRoot(cwd: string): Promise<string> {
	try {
		const { stdout } = await execFileAsync(
			'git',
			['-c', 'core.quotePath=false', 'rev-parse', '--show-toplevel'],
			{ cwd, timeout: ROOT_TIMEOUT_MS },
		)
		const root = stdout.trimEnd()
		if (root) return root
	} catch {
		// Not a repo (or git unreachable): fall through to the cwd fallback.
	}
	return path.resolve(cwd)
}

function pidOf(candidate: unknown): number | null {
	if (
		typeof candidate !== 'number' ||
		!Number.isInteger(candidate) ||
		candidate <= 0
	) {
		return null
	}
	return candidate
}

function httpUrl(candidate: unknown): string | null {
	if (
		typeof candidate !== 'string' ||
		(!candidate.startsWith('http://') && !candidate.startsWith('https://'))
	) {
		return null
	}
	return candidate
}

/** desk.lock JSON → validated lock; anything partial or corrupt is unusable. */
export function parseDeskLock(raw: string): DeskLock | null {
	try {
		const parsed: unknown = JSON.parse(raw)
		if (!isRecord(parsed)) return null
		const pid = pidOf(parsed.pid)
		const url = httpUrl(parsed.url)
		if (pid === null || url === null) return null
		const session = typeof parsed.session === 'string' ? parsed.session : ''
		const started = Date.parse(
			typeof parsed.startedAt === 'string' ? parsed.startedAt : '',
		)
		return {
			pid,
			url,
			session,
			startedAt: Number.isNaN(started) ? 0 : started,
		}
	} catch {
		return null
	}
}

function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch {
		return false
	}
}

/** Live locks under the repo's galley dir, newest started first. */
export async function readLiveDeskLocks(
	repoHash: string,
	baseDir: string = homedir(),
): Promise<DeskLock[]> {
	const sessions = await fs
		.readdir(path.join(baseDir, GALLEY_DIR, repoHash), {
			withFileTypes: true,
		})
		.catch(() => [])
	const locks = await Promise.all(
		sessions.map(async entry => {
			if (!entry.isDirectory()) return null
			const raw = await fs
				.readFile(
					path.join(
						baseDir,
						GALLEY_DIR,
						repoHash,
						entry.name,
						DESK_LOCK_FILE,
					),
					'utf8',
				)
				.catch(() => null)
			if (!raw) return null
			return parseDeskLock(raw)
		}),
	)
	return locks
		.filter(
			(lock): lock is DeskLock => lock !== null && isPidAlive(lock.pid),
		)
		.toSorted((first, second) => second.startedAt - first.startedAt)
}

/**
 * The most recently started running desk for cwd's repo, or null. Galley runs
 * at most one desk per session and warns on several; when several exist the
 * newest is the one the human just opened.
 */
export async function fetchLiveGalleyDesk(
	cwd: string,
	baseDir: string = homedir(),
): Promise<GalleyDesk | null> {
	const repoHash = deskDirHash(await resolveDeskRoot(cwd))
	const [live] = await readLiveDeskLocks(repoHash, baseDir)
	if (!live) return null
	return { session: live.session, url: live.url }
}
