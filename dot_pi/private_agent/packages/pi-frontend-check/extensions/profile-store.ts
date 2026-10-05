import {
	chmodSync,
	existsSync,
	mkdirSync,
	readdirSync,
	rmSync,
	statSync,
} from 'node:fs'
import { join } from 'node:path'

import { getAgentDir } from '@earendil-works/pi-coding-agent'

const MS_PER_DAY = 86_400_000
const PROFILE_RETENTION_DAYS = 14
/** Per-session browser profiles older than this are swept at extension load. */
export const PROFILE_RETENTION_MS = PROFILE_RETENTION_DAYS * MS_PER_DAY
const MAX_PROFILE_NAME_LENGTH = 80
const PRIVATE_DIR_MODE = 0o700

function profilesRoot(): string {
	return join(getAgentDir(), 'frontend-check', 'profiles')
}

function profileDirName(sessionKey: string): string {
	const cleaned = sessionKey
		.replace(/[^A-Za-z0-9._-]/g, '_')
		.slice(0, MAX_PROFILE_NAME_LENGTH)
	return cleaned || 'default'
}

/** Private Chromium user-data-dir owned by one session; cookies survive relaunches and resume. */
export function sessionProfileDir(sessionKey: string): string {
	const root = profilesRoot()
	mkdirSync(root, { recursive: true, mode: PRIVATE_DIR_MODE })
	const dir = join(root, profileDirName(sessionKey))
	mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE })
	chmodSync(dir, PRIVATE_DIR_MODE)
	return dir
}

function removeExpiredProfileDir(dir: string, cutoffMs: number): void {
	try {
		const stats = statSync(dir)
		if (!stats.isDirectory() || stats.mtimeMs >= cutoffMs) return
		rmSync(dir, { recursive: true, force: true })
	} catch {
		// A dir removed by its own session mid-sweep is not load-fatal.
	}
}

/** Delete profile dirs whose last browser write is older than the retention window. */
export function sweepStaleProfileDirs(
	retentionMs = PROFILE_RETENTION_MS,
): void {
	const root = profilesRoot()
	if (!existsSync(root)) return
	const cutoffMs = Date.now() - retentionMs
	for (const name of readdirSync(root))
		removeExpiredProfileDir(join(root, name), cutoffMs)
}
