// Apple `container` CLI boundary: the only place this extension talks to the
// runtime. It never creates, starts or removes containers - wt owns their
// lifecycle - it only streams commands into the workspace container and reads
// the host-visible facts a session needs (state, address, liveness). Every call
// runs in its own guest session (see exec-session.ts) so its process group can be
// killed when the call ends without one, because a guest command outlives the
// host client that started it.
import { spawnSync } from 'node:child_process'

import {
	CONTAINER_BIN,
	MS_PER_SECOND,
	runCapture,
	runStreaming,
} from './container-cli.ts'
import {
	GUEST_CONTROL_TIMEOUT_SECONDS,
	abandonedRecords,
	clearRecord,
	commandLabel,
	execRecordDir,
	guestExecArgv,
	guestKillScript,
	newExecToken,
	processIsAlive,
	readExecRecords,
	writeRecord,
} from './exec-session.ts'

import type { CliStreamOptions, RunResult } from './container-cli.ts'

const NOT_RUNNING_HINT =
	'Apple container runtime is not responding. Run `container system start` and reload this session.'
/** Calls without a timeout still get a deadline, so no guest process can become immortal. */
export const GUEST_CEILING_SECONDS = 900
/**
 * The Apple container CLI's cold path measures 3-9 s on a healthy VM, so a short
 * probe reports a live VM as dead. The first attempt stays short, the second is
 * patient; a starved VM fails both, and their sum stays under the command cap so
 * the guard never costs more than the hang it prevents.
 */
export const PROBE_FAST_SECONDS = 5
export const PROBE_PATIENT_SECONDS = 25
/** Distinguishes two calls that a session starts in the same millisecond. */
let execSequence = 0

export interface ExecStreamOptions extends CliStreamOptions {
	/** The pi session that started the call, for the ownership record. */
	ownerSession?: string
}

/** Actionable text for a failed exec: a stopped container is not a mystery. */
export function containerExecFailure(
	containerName: string,
	error: unknown,
): string {
	const message = error instanceof Error ? error.message : String(error)
	const lower = message.toLowerCase()
	if (lower.includes('econnrefused') || lower.includes('connection refused'))
		return NOT_RUNNING_HINT
	if (
		lower.includes('not running') ||
		lower.includes('no such container') ||
		lower.includes('not found')
	) {
		return `Container ${containerName} is not running; run /container sync (or wt sync) and retry.`
	}
	return message
}

/** Host-side address of a running container, for servers the host must reach. */
export function bestEffortContainerIp(containerName: string): string | null {
	const listing = spawnSync(CONTAINER_BIN, ['list'], { encoding: 'utf-8' })
	if (listing.status !== 0 || typeof listing.stdout !== 'string') return null
	const ownLine = listing.stdout
		.split('\n')
		.find(line => line.includes(containerName))
	return ownLine?.match(/(\d{1,3}(?:\.\d{1,3}){3})/)?.[1] ?? null
}

/** Only the inventory fields this module reads; the runtime's schema is not ours to model. */
interface ContainerEntry {
	id: string
	status: { networks?: { ipv4Gateway?: string }[] }
}

function isContainerEntry(candidate: unknown): candidate is ContainerEntry {
	if (typeof candidate !== 'object' || candidate === null) return false
	if (!('id' in candidate) || typeof candidate.id !== 'string') return false
	return (
		'status' in candidate &&
		typeof candidate.status === 'object' &&
		candidate.status !== null
	)
}

/**
 * The host as the VM addresses it. Read from the runtime's inventory instead of assumed:
 * the bridge subnet is the runtime's choice, and a hardcoded gateway sends the model - and
 * the human - to an address nothing answers on a machine that picked another subnet.
 */
export function gatewayFromInventory(
	inventory: string,
	containerName: string,
): string | null {
	let parsed: unknown
	try {
		parsed = JSON.parse(inventory)
	} catch {
		return null
	}
	if (!Array.isArray(parsed)) return null
	for (const entry of parsed) {
		if (!isContainerEntry(entry) || entry.id !== containerName) continue
		const gateway = entry.status.networks?.[0]?.ipv4Gateway
		if (typeof gateway === 'string' && gateway) return gateway
	}
	return null
}

export function bestEffortHostGateway(containerName: string): string | null {
	const listing = spawnSync(CONTAINER_BIN, ['list', '--format', 'json'], {
		encoding: 'utf-8',
	})
	if (listing.status !== 0 || typeof listing.stdout !== 'string') return null
	return gatewayFromInventory(listing.stdout, containerName)
}

export async function stopContainer(containerName: string): Promise<RunResult> {
	return runCapture(['stop', containerName])
}

/** Actionable text for a container that runs but no longer answers: nothing here is a mystery. */
export function containerUnresponsiveMessage(containerName: string): string {
	return `Container ${containerName} is not answering: its VM is starved by leftover guest work. Run /container reap, or /container restart for a VM that answers nothing at all.`
}

/**
 * Deadline handed to the guest `timeout`. The call's own timeout wins; without
 * one the ceiling applies, because an unbounded guest command outlives the tool
 * call that started it and starves the VM for every later one.
 */
export function guestDeadlineSeconds(timeoutSeconds?: number): number {
	return timeoutSeconds ?? GUEST_CEILING_SECONDS
}

/** Does the VM answer at all? A starved VM leaves every exec hanging for minutes. */
export async function probeContainerAlive(
	containerName: string,
): Promise<boolean> {
	if (await probeOnce(containerName, PROBE_FAST_SECONDS)) return true
	return await probeOnce(containerName, PROBE_PATIENT_SECONDS)
}

async function probeOnce(
	containerName: string,
	budgetSeconds: number,
): Promise<boolean> {
	try {
		const run = await runStreaming(['exec', containerName, 'true'], {
			timeoutSeconds: budgetSeconds,
		})
		return run.exitCode === 0
	} catch {
		return false
	}
}

/**
 * Kill the guest process groups of these tokens, then clear their records. A token whose
 * group is already gone counts as handled. Killing by group touches only what that call
 * started: another session's work is in another group, and work detached with `setsid` is
 * in a group of its own.
 */
export async function killGuestTokens(
	containerName: string,
	tokens: readonly string[],
	recordDir: string = execRecordDir(),
): Promise<string[]> {
	if (!tokens.length) return []
	const run = await runCapture(
		[
			'exec',
			containerName,
			'sh',
			'-c',
			guestKillScript(),
			'wt-exec',
			...tokens,
		],
		GUEST_CONTROL_TIMEOUT_SECONDS,
	)
	if (run.exitCode !== 0) {
		throw new Error(
			containerExecFailure(
				containerName,
				run.stderr.trim() || 'guest kill failed',
			),
		)
	}
	const reported = new Set(
		run.stdout
			.split('\n')
			.map(line => line.trim())
			.filter(Boolean),
	)
	const handled = tokens.filter(token => reported.has(token))
	for (const token of handled) clearRecord(recordDir, containerName, token)
	return [...handled]
}

/**
 * Kill guest work whose owning pi process is gone, or whose deadline passed long ago. Any
 * session may run this: a live owner is never touched, so a second session cannot reap the
 * work of one that is still running.
 */
export async function reapAbandonedGuestSessions(
	containerName: string,
	recordDir: string = execRecordDir(),
	now: number = Date.now(),
): Promise<number> {
	const abandoned = abandonedRecords(
		readExecRecords(recordDir, containerName),
		now,
		processIsAlive,
	)
	if (!abandoned.length) return 0
	await killGuestTokens(
		containerName,
		abandoned.map(record => record.token),
		recordDir,
	)
	return abandoned.length
}

export async function execInContainer(
	containerName: string,
	workdir: string,
	command: string,
	options: ExecStreamOptions = {},
): Promise<RunResult> {
	const recordDir = execRecordDir()
	const deadlineSeconds = guestDeadlineSeconds(options.timeoutSeconds)
	const startedAt = Date.now()
	const token = newExecToken(process.pid, startedAt, (execSequence += 1))
	writeRecord(recordDir, {
		token,
		containerName,
		ownerPid: process.pid,
		ownerSession: options.ownerSession ?? '',
		deadlineMs: startedAt + deadlineSeconds * MS_PER_SECOND,
		startedAt,
		label: commandLabel(command),
	})
	return runStreaming(
		[
			'exec',
			'-w',
			workdir,
			containerName,
			...guestExecArgv(token, deadlineSeconds, command),
		],
		{ ...options, timeoutSeconds: deadlineSeconds },
	).then(
		run => {
			// The call may have detached a server on purpose: its group is left alone.
			clearRecord(recordDir, containerName, token)
			return run
		},
		async (error: unknown) => {
			// A call that did not finish (timeout, interrupt, failure) takes its whole group
			// with it. A VM too starved to answer the kill keeps the record for the next reap.
			await killGuestTokens(containerName, [token], recordDir).catch(
				() => undefined,
			)
			throw error
		},
	)
}
