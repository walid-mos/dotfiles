// Apple `container` CLI boundary: the only place this extension talks to the
// runtime. It never creates, starts or removes containers - wt owns their
// lifecycle - it only streams commands into the workspace's guest (its own VM,
// or its namespace on the shared dev VM) and reads the host-visible facts a
// session needs (state, address, liveness). Every call runs in its own guest
// session (see exec-session.ts) so its process group can be killed when the
// call ends without one, because a guest command outlives the host client that
// started it. The one exception to "never start or stop" is the runtime's own
// `system stop`/`start`, which /container restart escalates to when a starved
// VM ignores even a stop.
import { MS_PER_SECOND, runCapture, runStreaming } from './container-cli.ts'
import {
	DEVVM_NAME,
	devvmExecArgv,
	devvmProbeArgv,
	devvmRootExecArgv,
	devvmSubpath,
} from './devvm.ts'
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
import { noteProbeVerdict } from './liveness.ts'

import type { CliStreamOptions, RunResult } from './container-cli.ts'

const NOT_RUNNING_HINT =
	'Apple container runtime is not responding. Run `container system start` and reload this session.'
/** Calls without a timeout still get a deadline, so no guest process can become immortal. */
export const GUEST_CEILING_SECONDS = 900
/** `container stop` waits on the guest: a wedged VM leaves it hanging forever, so it gets a budget. */
const STOP_TIMEOUT_SECONDS = 30
/** The runtime's own services, and the only lever left when a VM is wedged beyond `stop`. */
const RUNTIME_TIMEOUT_SECONDS = 90
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

/**
 * Where a guest call runs. The workspace's identity is `containerName` on both
 * arms - the container for a container vehicle, the namespace for a devvm one -
 * so records, liveness verdicts and messages key on one name throughout.
 */
export type GuestTarget =
	| { kind: 'container'; containerName: string }
	| {
			kind: 'devvm'
			containerName: string
			/** The tree's path inside the dev VM, read once per session. */
			treePath: string
	  }

/** Actionable text for a failed exec: a stopped workspace is not a mystery. */
export function containerExecFailure(
	target: GuestTarget,
	error: unknown,
): string {
	const { containerName } = target
	const message = error instanceof Error ? error.message : String(error)
	const lower = message.toLowerCase()
	if (lower.includes('econnrefused') || lower.includes('connection refused'))
		return NOT_RUNNING_HINT
	if (
		!(lower.includes('not running') ||
		lower.includes('no such container') ||
		lower.includes('not found') ||
		(target.kind === 'devvm' && lower.includes('netns')))
	) {
		return message
	}
	return target.kind === 'devvm'
			? `Workspace ${containerName} is not reachable on the dev VM (${DEVVM_NAME}); run /container sync (or wt sync) and retry.`
			: `Container ${containerName} is not running; run /container sync (or wt sync) and retry.`
}

/** Stop one container; bounded because the relay waits on a guest a starved VM never answers. */
export async function stopContainer(containerName: string): Promise<RunResult> {
	return runCapture(['stop', containerName], STOP_TIMEOUT_SECONDS)
}

/**
 * Stop then start the runtime's own services, and say whether it came back: the only
 * recovery a starved VM leaves, because it blocks `exec` and `stop` machine-wide.
 */
export async function restartContainerRuntime(): Promise<boolean> {
	const stopped = await runCapture(
		['system', 'stop'],
		RUNTIME_TIMEOUT_SECONDS,
	)
	if (stopped.exitCode !== 0) return false
	const started = await runCapture(
		['system', 'start'],
		RUNTIME_TIMEOUT_SECONDS,
	)
	return started.exitCode === 0
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

/** Does the guest still answer at all? A starved VM leaves every exec hanging for minutes. */
export async function probeContainerAlive(
	target: GuestTarget,
): Promise<boolean> {
	const answered =
		(await probeOnce(target, PROBE_FAST_SECONDS)) ||
		(await probeOnce(target, PROBE_PATIENT_SECONDS))
	noteProbeVerdict(target.containerName, answered)
	return answered
}

/** The cheapest answer to "is this devvm workspace there": one exec through its namespace. */
export async function devvmWorkspaceAnswering(
	workspaceName: string,
): Promise<boolean> {
	try {
		const run = await runStreaming(devvmProbeArgv(workspaceName), {
			timeoutSeconds: PROBE_FAST_SECONDS,
		})
		return run.exitCode === 0
	} catch {
		return false
	}
}

async function probeOnce(
	target: GuestTarget,
	budgetSeconds: number,
): Promise<boolean> {
	const argv =
		target.kind === 'container'
			? ['exec', target.containerName, 'true']
			: devvmProbeArgv(target.containerName)
	try {
		const run = await runStreaming(argv, { timeoutSeconds: budgetSeconds })
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
	target: GuestTarget,
	tokens: readonly string[],
	recordDir: string = execRecordDir(),
): Promise<string[]> {
	if (!tokens.length) return []
	// The kill runs where the pidfiles live: the workspace's own VM, or the dev
	// VM's root namespace, whose /tmp every workspace's mount namespace shares.
	const base =
		target.kind === 'container'
			? ['exec', target.containerName]
			: devvmRootExecArgv([])
	const run = await runCapture(
		[...base, 'sh', '-c', guestKillScript(), 'wt-exec', ...tokens],
		GUEST_CONTROL_TIMEOUT_SECONDS,
	)
	if (run.exitCode !== 0) {
		throw new Error(
			containerExecFailure(
				target,
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
	for (const token of handled)
		clearRecord(recordDir, target.containerName, token)
	return [...handled]
}

/**
 * Kill guest work whose owning pi process is gone, or whose deadline passed long ago. Any
 * session may run this: a live owner is never touched, so a second session cannot reap the
 * work of one that is still running.
 */
export async function reapAbandonedGuestSessions(
	target: GuestTarget,
	recordDir: string = execRecordDir(),
	now: number = Date.now(),
): Promise<number> {
	const abandoned = abandonedRecords(
		readExecRecords(recordDir, target.containerName),
		now,
		processIsAlive,
	)
	if (!abandoned.length) return 0
	await killGuestTokens(
		target,
		abandoned.map(record => record.token),
		recordDir,
	)
	return abandoned.length
}

/** The `container` argv of one guest call, by vehicle: `-w` for a container, the namespace chain for a devvm. */
function guestArgv(input: {
	target: GuestTarget
	workdir: string
	token: string
	deadlineSeconds: number
	command: string
}): string[] {
	const { target, workdir, token, deadlineSeconds, command } = input
	if (target.kind === 'container') {
		return [
			'exec',
			'-w',
			workdir,
			target.containerName,
			...guestExecArgv(token, deadlineSeconds, command),
		]
	}
	return devvmExecArgv({
		workspaceName: target.containerName,
		treePath: target.treePath,
		subpath: devvmSubpath(workdir),
		token,
		deadlineSeconds,
		command,
	})
}

export async function execInContainer(
	target: GuestTarget,
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
		containerName: target.containerName,
		ownerPid: process.pid,
		ownerSession: options.ownerSession ?? '',
		deadlineMs: startedAt + deadlineSeconds * MS_PER_SECOND,
		startedAt,
		label: commandLabel(command),
	})
	return runStreaming(
		guestArgv({ target, workdir, token, deadlineSeconds, command }),
		{
			...options,
			timeoutSeconds: deadlineSeconds,
		},
	).then(
		run => {
			// The call may have detached a server on purpose: its group is left alone.
			clearRecord(recordDir, target.containerName, token)
			return run
		},
		async (error: unknown) => {
			// A call that did not finish (timeout, interrupt, failure) takes its whole group
			// with it. A VM too starved to answer the kill keeps the record for the next reap.
			await killGuestTokens(target, [token], recordDir).catch(
				() => undefined,
			)
			throw error
		},
	)
}
