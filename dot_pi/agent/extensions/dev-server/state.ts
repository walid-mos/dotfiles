/**
 * dev-server slot state: one pidfile + log per project working directory.
 *
 * The slot key is the absolute cwd slugified; two sessions driving the same
 * directory share the slot, so a second `start` reports already-running
 * instead of racing for the same port. Records live under /tmp because a dev
 * server is ephemeral by nature - nothing to keep across reboots.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const STATE_ROOT = join('/tmp', 'pi-dev-server')
const JSON_INDENT_SPACES = 2

/** What one running (or once-running) server leaves behind. */
export interface ServerRecord {
	pid: number
	command: string
	cwd: string
	startedAt: number
	logPath: string
}

export interface SlotPaths {
	dir: string
	log: string
	pidfile: string
}

/**
 * The sandboxed slot: the same path text as the host slot, resolved inside the
 * VM, where the server and its log actually live. `server.pgid` holds the
 * guest process group, which is what a guest stop signals.
 */
export interface GuestSlotPaths {
	dir: string
	log: string
	pgidfile: string
}

/** Filesystem-safe slot name for an absolute directory path. */
export function slugFor(cwd: string): string {
	const slug = cwd.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
	return slug === '' ? 'root' : slug
}

/** Where this project's server state lives. */
export function slotPaths(cwd: string): SlotPaths {
	const dir = join(STATE_ROOT, slugFor(cwd))
	return {
		dir,
		log: join(dir, 'server.log'),
		pidfile: join(dir, 'server.json'),
	}
}

/** The same slot inside the guest: STATE_ROOT is a path, and each side mounts its own /tmp. */
export function guestSlotPaths(cwd: string): GuestSlotPaths {
	const dir = join(STATE_ROOT, slugFor(cwd))
	return {
		dir,
		log: join(dir, 'server.log'),
		pgidfile: join(dir, 'server.pgid'),
	}
}

/** True while the pid answers signal 0; pid reuse is accepted for dev tooling. */
export function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch {
		return false
	}
}

// oxlint-disable-next-line nextnode/no-generic-runtime-guard - own pidfile JSON, no schema roundtrip warranted
function isRecord(parsed: unknown): parsed is ServerRecord {
	if (typeof parsed !== 'object' || parsed === null) return false
	// oxlint-disable-next-line nextnode/no-type-assertion - narrowing one own-file JSON shape
	const record = parsed as Partial<ServerRecord>
	return (
		typeof record.pid === 'number' &&
		typeof record.command === 'string' &&
		typeof record.cwd === 'string' &&
		typeof record.startedAt === 'number' &&
		typeof record.logPath === 'string'
	)
}

/** The slot's record, or undefined when absent or unusable. */
export function readRecord(pidfile: string): ServerRecord | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(pidfile, 'utf8'))
		if (isRecord(parsed)) return parsed
	} catch {
		// absent or corrupt pidfile -> no usable record
	}
	return undefined
}

export function writeRecord(pidfile: string, record: ServerRecord): void {
	mkdirSync(dirname(pidfile), { recursive: true })
	writeFileSync(pidfile, JSON.stringify(record, null, JSON_INDENT_SPACES))
}

export function clearRecord(pidfile: string): void {
	rmSync(pidfile, { force: true })
}
