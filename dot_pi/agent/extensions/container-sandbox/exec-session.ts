// Guest process ownership for sandbox calls. Every `container exec` runs its command in
// its own guest session, so the process group it starts can be killed as a whole when the
// call ends. Killing the host client never did that: a call killed at its timeout left its
// guest tree running, and orphaned guest work is what starves the VM until every later exec
// hangs. Ownership is recorded host-side (which pi process, which session, which deadline),
// so work whose owner is gone is reaped before a session reuses the VM, and no call ever
// kills another session's work by heuristic. Work detached on purpose (a dev server started
// with setsid) is in a group of its own and outlives the call that started it.
//
// This module is the pure contract: token, guest wrapper, kill script and record shapes.
// container.ts runs them, session.ts writes the session-side records.
import {
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Guest directory holding one pidfile per call; a VM-local tmpfs, so it starts empty. */
export const GUEST_EXEC_DIR = '/tmp/wt-exec'
/** The guest's own backstop between SIGTERM and SIGKILL inside `timeout`. */
export const GUEST_KILL_GRACE_SECONDS = 5
/** A kill or reap exec that hangs means a starved VM; it must never hold up the tool call. */
export const GUEST_CONTROL_TIMEOUT_SECONDS = 10
/** A record past its own deadline by this much can only be a corpse. */
export const STALE_RECORD_GRACE_MS = 60_000
const LABEL_MAX_CHARS = 80
const BASE36_RADIX = 36
const SAFE_SEGMENT = /[^A-Za-z0-9._-]/gu

export interface ExecRecord {
	token: string
	containerName: string
	ownerPid: number
	ownerSession: string
	deadlineMs: number
	startedAt: number
	label: string
}

export interface SessionRecord {
	sessionId: string
	containerName: string
	ownerPid: number
	worktree: string
	branch: string
	startedAt: number
}

/** Extension state lives in XDG state, next to wt's registry: never in the mounted worktree. */
export function sandboxStateDir(home: string = homedir()): string {
	return join(home, '.local', 'state', 'pi-agent', 'container-sandbox')
}

export function execRecordDir(home?: string): string {
	return join(sandboxStateDir(home), 'exec')
}

export function sessionRecordDir(home?: string): string {
	return join(sandboxStateDir(home), 'sessions')
}

/** A token is a filename and a shell argument at once: keep it to unreserved characters. */
export function safeSegment(segment: string): string {
	return segment.replace(SAFE_SEGMENT, '-')
}

export function recordFileName(containerName: string, id: string): string {
	return `${safeSegment(containerName)}.${safeSegment(id)}.json`
}

/** Unique per call: the owning pi process, the start time and a per-process sequence. */
export function newExecToken(
	ownerPid: number,
	now: number,
	sequence: number,
): string {
	return `${ownerPid}-${now.toString(BASE36_RADIX)}-${sequence}`
}

/** One line of a command, short enough to identify it in a status line. */
export function commandLabel(command: string): string {
	const collapsed = command.replace(/\s+/gu, ' ').trim()
	return collapsed.length > LABEL_MAX_CHARS
		? `${collapsed.slice(0, LABEL_MAX_CHARS - 1)}…`
		: collapsed
}

/**
 * The guest argv for one call. `sh -c` is needed for the pidfile handshake, `setsid -w`
 * puts the call at the head of its own session while still reporting the command's exit
 * status, and `$0` of the inner shell is the pidfile so `echo $$` writes the id of the
 * process that then `exec`s into `timeout` - the process group to kill.
 */
export function guestExecArgv(
	token: string,
	deadlineSeconds: number,
	command: string,
): string[] {
	return [
		'sh',
		'-c',
		`mkdir -p ${GUEST_EXEC_DIR} 2>/dev/null; ` +
			`setsid -w sh -c 'echo $$ > ${GUEST_EXEC_DIR}/"$0".pgid; exec "$@"' "$1" ` +
			`timeout -k ${GUEST_KILL_GRACE_SECONDS} "$2" bash -lc "$3"`,
		'wt-exec',
		token,
		String(deadlineSeconds),
		command,
	]
}

/**
 * Kill the process group of each token and drop its pidfile, printing the tokens it
 * handled. A token with no pidfile is handled too (nothing left to kill), so the host can
 * clear its record either way. The caller runs this in a fresh exec, never in the group
 * being killed.
 */
export function guestKillScript(): string {
	return [
		'for t in "$@"; do',
		`  f=${GUEST_EXEC_DIR}/"$t".pgid`,
		'  [ -f "$f" ] || { echo "$t"; continue; }',
		'  p=$(cat "$f" 2>/dev/null)',
		'  case $p in ""|*[!0-9]*) rm -f "$f"; echo "$t"; continue;; esac',
		'  kill -9 -"$p" 2>/dev/null',
		'  rm -f "$f"',
		'  echo "$t"',
		'done',
	].join('\n')
}

/** Live work is only ever abandoned when the pi process that started it is gone. */
export function processIsAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		// EPERM means the pid exists under another owner: a foreign live process, not a corpse.
		return (
			typeof error === 'object' &&
			error !== null &&
			'code' in error &&
			error.code === 'EPERM'
		)
	}
}

/**
 * Records safe to kill: their owner is gone, or the guest deadline that was supposed to
 * end them passed by a wide margin. A live owner is never reaped, so a second session
 * cannot kill the work of a session that is still running.
 */
export function abandonedRecords(
	records: ExecRecord[],
	now: number,
	isAlive: (pid: number) => boolean,
): ExecRecord[] {
	return records.filter(
		record =>
			!isAlive(record.ownerPid) ||
			now >= record.deadlineMs + STALE_RECORD_GRACE_MS,
	)
}

export function writeRecord(
	directory: string,
	record: ExecRecord | SessionRecord,
): void {
	mkdirSync(directory, { recursive: true })
	const kind = 'sessionId' in record ? record.sessionId : record.token
	writeFileSync(
		join(directory, recordFileName(record.containerName, kind)),
		`${JSON.stringify(record)}\n`,
	)
}

export function clearRecord(
	directory: string,
	containerName: string,
	id: string,
): void {
	rmSync(join(directory, recordFileName(containerName, id)), { force: true })
}

function readRecordFiles(directory: string): unknown[] {
	let names: string[]
	try {
		names = readdirSync(directory)
	} catch {
		return []
	}
	const records: unknown[] = []
	for (const name of names) {
		if (!name.endsWith('.json')) continue
		try {
			const parsed: unknown = JSON.parse(
				readFileSync(join(directory, name), 'utf-8'),
			)
			records.push(parsed)
		} catch {
			// A half-written or hand-edited record is not worth failing a session over.
		}
	}
	return records
}

/**
 * Field readers, not schema validation: the records are this extension's own files, and a
 * missing or mistyped field is dropped rather than repaired. A field that is not a string
 * reads as null so the caller can reject the whole record with one comparison.
 */
function textField(record: object, key: string): string | null {
	const fieldValue: unknown = Reflect.get(record, key)
	if (typeof fieldValue !== 'string') return null
	return fieldValue
}

function countField(record: object, key: string): number | null {
	const fieldValue: unknown = Reflect.get(record, key)
	if (
		typeof fieldValue !== 'number' ||
		!Number.isInteger(fieldValue) ||
		fieldValue <= 0
	) {
		return null
	}
	return fieldValue
}

export function parseExecRecord(candidate: unknown): ExecRecord | null {
	if (typeof candidate !== 'object' || candidate === null) return null
	const token = textField(candidate, 'token')
	const containerName = textField(candidate, 'containerName')
	const ownerPid = countField(candidate, 'ownerPid')
	const ownerSession = textField(candidate, 'ownerSession')
	const deadlineMs = countField(candidate, 'deadlineMs')
	const startedAt = countField(candidate, 'startedAt')
	if (
		!token ||
		!containerName ||
		// Informational, and an ownerless record is still reapable: only absent is invalid.
		ownerSession === null ||
		ownerPid === null ||
		deadlineMs === null ||
		startedAt === null
	) {
		return null
	}
	return {
		token,
		containerName,
		ownerPid,
		ownerSession,
		deadlineMs,
		startedAt,
		label: textField(candidate, 'label') ?? '',
	}
}

export function parseSessionRecord(candidate: unknown): SessionRecord | null {
	if (typeof candidate !== 'object' || candidate === null) return null
	const sessionId = textField(candidate, 'sessionId')
	const containerName = textField(candidate, 'containerName')
	const ownerPid = countField(candidate, 'ownerPid')
	const startedAt = countField(candidate, 'startedAt')
	if (!sessionId || !containerName || ownerPid === null || startedAt === null)
		return null
	return {
		sessionId,
		containerName,
		ownerPid,
		worktree: textField(candidate, 'worktree') ?? '',
		branch: textField(candidate, 'branch') ?? '',
		startedAt,
	}
}

export function readExecRecords(
	directory: string,
	containerName: string,
): ExecRecord[] {
	return readRecordFiles(directory)
		.map(parseExecRecord)
		.filter(
			(record): record is ExecRecord =>
				record !== null && record.containerName === containerName,
		)
}

export function readSessionRecords(directory: string): SessionRecord[] {
	return readRecordFiles(directory)
		.map(parseSessionRecord)
		.filter((record): record is SessionRecord => record !== null)
}
