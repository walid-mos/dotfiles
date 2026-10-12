import { chmodSync, mkdirSync, readlinkSync, rmSync, statSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'

import { getAgentDir } from '@earendil-works/pi-coding-agent'

import { hasErrorCode } from './error-code.ts'

const MAX_PROFILE_NAME_LENGTH = 80
const PRIVATE_DIR_MODE = 0o700
const REMOVE_RETRIES = 2
/** Brave rewrites it on every run, so its mtime dates the last use and pruning never refreshes it. */
const LAST_USE_FILE = 'Local State'
/** Chromium's lock symlink, `<hostname>-<pid>`: a killed browser leaves it behind, so the pid is checked. */
const LOCK_FILE = 'SingletonLock'
/** Regenerable caches only (HTTP, bytecode, GPU shaders, component downloads); login state is never listed. */
const CACHE_DIRS = [
	'Default/Cache',
	'Default/Code Cache',
	'Default/GPUCache',
	'Default/DawnGraphiteCache',
	'Default/DawnWebGPUCache',
	'GraphiteDawnCache',
	'GrShaderCache',
	'ShaderCache',
	'GPUPersistentCache',
	'component_crx_cache',
	'screen_ai',
]

export function profilesRoot(): string {
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

function remove(path: string): void {
	rmSync(path, { recursive: true, force: true, maxRetries: REMOVE_RETRIES })
}

/** Only a lock naming a live process of this host counts; anything unreadable is treated as live. */
function lockOwnerAlive(target: string): boolean {
	const separator = target.lastIndexOf('-')
	const host = target.slice(0, separator)
	const pid = Number(target.slice(separator + 1))
	if (host !== hostname() || !Number.isInteger(pid) || pid <= 0) return true
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		return !hasErrorCode(error, 'ESRCH')
	}
}

function isInUse(dir: string): boolean {
	try {
		return lockOwnerAlive(readlinkSync(join(dir, LOCK_FILE)))
	} catch (error) {
		return !hasErrorCode(error, 'ENOENT')
	}
}

function lastUseMs(dir: string): number {
	try {
		return statSync(join(dir, LAST_USE_FILE)).mtimeMs
	} catch {
		return statSync(dir).mtimeMs
	}
}

export function maintainProfileDir(dir: string, cutoffMs: number): void {
	if (!statSync(dir).isDirectory() || isInUse(dir)) return
	if (lastUseMs(dir) < cutoffMs) {
		remove(dir)
		return
	}
	for (const cache of CACHE_DIRS) remove(join(dir, cache))
}
