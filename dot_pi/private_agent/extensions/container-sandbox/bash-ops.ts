// Bash routing: pi's bash tool runs `container exec` in the workspace VM. Only
// the worktree is mounted (at /workspace), so host paths outside it have no
// container equivalent and are refused with an explanation the model can act on.
// Each call first checks that the VM still answers, so a starved VM fails with
// an actionable error instead of holding the turn until pi's timeout.
// Two commands do not belong in the VM and are handled here: a bare `git` runs on
// the host, because the linked worktree's `.git` file names a host path the mount
// does not carry, and a host-side write/edit makes the guest touch the file it
// changed, because virtiofs delivers no event for a host write and an in-VM
// watcher would otherwise never see it.
import {
	containerExecFailure,
	containerUnresponsiveMessage,
	execInContainer,
	probeContainerAlive,
} from './container.ts'
import { containerRecentlyUnresponsive } from './liveness.ts'

import type { BashOperations } from '@earendil-works/pi-coding-agent'
import type { ExecStreamOptions, GuestTarget } from './container.ts'

/** A healthy VM answers in ~100 ms; a starved one never answers at all. */
const PROBE_FRESH_MS = 10_000

/**
 * Said once, before the command's own output: a command that silently ran somewhere
 * else is a surprise, and the model has to know which side of the mount it just used.
 */
export const HOST_GIT_NOTICE =
	"[git ran on the macOS host: the VM mounts only the worktree, and the worktree's `.git` file points at a host path it cannot read]\n"

/** The tools whose host-side writes the guest has to be told about. */
const WATCHED_FILE_TOOLS = new Set(['write', 'edit'])

/** Leading `VAR=value` assignments are not the command's own name. */
const LEADING_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/u

/** The command's own name: leading whitespace and environment prefixes are not it. */
export function commandName(command: string): string {
	let rest = command.trimStart()
	while (LEADING_ASSIGNMENT.test(rest))
		rest = rest.replace(LEADING_ASSIGNMENT, '')
	return rest.split(/\s/u)[0] ?? ''
}

/**
 * The host spelling of a command written for the guest: `/workspace` names the mounted
 * worktree, and the host knows that tree by its own path. Only a whole path argument is
 * translated, so `/workspace-2` or `/elsewhere/workspace` - which merely share the prefix -
 * stay as they are, and the command's own spacing survives.
 */
export function hostGitCommand(
	command: string,
	mountSource: string,
	workdir: string,
): string {
	return command
		.split(/(\s+)/u)
		.map(part => hostGitPathArgument(part, mountSource, workdir))
		.join('')
}

function hostGitPathArgument(
	argument: string,
	mountSource: string,
	workdir: string,
): string {
	if (argument === workdir) return mountSource
	if (!argument.startsWith(`${workdir}/`))
		return argument
	return `${mountSource}${argument.slice(workdir.length)}`
}

/** Which side a command runs on, and the command that side receives. */
export type CommandRoute =
	| { side: 'host'; command: string }
	| { side: 'container' }

/**
 * A bare `git` is the one command the VM cannot run: the linked worktree's `.git` file names
 * a host path, which is not mounted, so every git call there fails with
 * `fatal: not a git repository`. Git also belongs on APFS - it reads and writes the
 * repository directly instead of through the share - so the command is moved, not rewritten.
 */
export function routeCommand(
	command: string,
	mountSource: string,
	workdir: string,
): CommandRoute {
	if (commandName(command) !== 'git') return { side: 'container' }
	return {
		side: 'host',
		command: hostGitCommand(command, mountSource, workdir),
	}
}

/**
 * The guest command that wakes a watcher after a host-side edit, or null when the VM has
 * nothing to see: a host write reaches it as changed bytes with no event (virtiofs delivers
 * no notification), which is what leaves an in-VM vite/tsx watcher stale exactly while an
 * agent is editing. The guest touches the file itself, so its own watcher fires.
 */
export function guestTouchCommand(
	mountSource: string,
	workdir: string,
	edit: {
		toolName: string
		input: Record<string, unknown>
		isError: boolean
	},
): string | null {
	if (edit.isError || !WATCHED_FILE_TOOLS.has(edit.toolName)) return null
	const target = edit.input.path
	if (typeof target !== 'string' || !target) return null
	let guestPath: string
	try {
		guestPath = toContainerPath(mountSource, workdir, target)
	} catch {
		return null
	}
	return `touch -- '${guestPath.split("'").join(`'\\''`)}'`
}

/** Probing on every call would double the cost of trivial commands. */
export function shouldProbeContainer(
	lastHealthyAt: number | undefined,
	now: number,
): boolean {
	return !lastHealthyAt || now - lastHealthyAt >= PROBE_FRESH_MS
}

/**
 * Map a host path into the guest. Optional properties on ExecStreamOptions
 * forbid explicit undefined, so unset keys are omitted here instead of the
 * call site. An unset session leaves the record saying only which pi process
 * owns the call, which is all a reap needs.
 */
function streamOptions(
	signal: AbortSignal | undefined,
	timeout: number | undefined,
	ownerSession: string,
): ExecStreamOptions {
	const options: ExecStreamOptions = {}
	if (signal) options.signal = signal
	if (timeout) options.timeoutSeconds = timeout
	if (ownerSession) options.ownerSession = ownerSession
	return options
}

export function toContainerPath(
	mountSource: string,
	workdir: string,
	hostCwd: string,
): string {
	if (hostCwd === mountSource) return workdir
	if (hostCwd.startsWith(`${mountSource}/`)) {
		return `${workdir}${hostCwd.slice(mountSource.length)}`
	}
	throw new Error(
		`Container sandbox: ${hostCwd} is outside the mounted worktree (${mountSource}); only that worktree exists in the container. Use the read/edit/write tools for project files, or the host tool for macOS paths.`,
	)
}

/** pi's option objects forbid an explicit undefined, so unset keys are omitted here. */
function hostExecOptions(
	onData: (data: Buffer) => void,
	signal: AbortSignal | undefined,
	timeout: number | undefined,
): {
	onData: (data: Buffer) => void
	signal?: AbortSignal
	timeout?: number
} {
	const options: {
		onData: (data: Buffer) => void
		signal?: AbortSignal
		timeout?: number
	} = { onData }
	if (signal) options.signal = signal
	if (timeout) options.timeout = timeout
	return options
}

/**
 * Which guest a call belongs to, and where the mounted worktree lives on both
 * sides. `guest` says how the exec boundary reaches the workspace - its own VM
 * unless stated - and defaults to that, so a caller that knows only the name
 * keeps the container behaviour.
 */
export interface ContainerBashTarget {
	containerName: string
	mountSource: string
	workdir: string
	ownerSession: string
	guest?: GuestTarget
}

/**
 * `hostOps` is pi's own local shell, the one the `host` tool uses: a command routed to the
 * host runs exactly as a host command does, with the same environment and shell.
 */
export function createContainerBashOps(
	target: ContainerBashTarget,
	hostOps: BashOperations,
): BashOperations {
	const { containerName, mountSource, workdir, ownerSession } = target
	const guest: GuestTarget = target.guest ?? {
		kind: 'container',
		containerName,
	}
	let lastHealthyAt: number | undefined

	const ensureResponsive = async (): Promise<void> => {
		// A VM already found starved is not probed again: the verdict is what the caller needs,
		// and re-probing it would spend the very budget this guard exists to save.
		if (containerRecentlyUnresponsive(containerName))
			throw new Error(containerUnresponsiveMessage(containerName))
		const now = Date.now()
		if (!shouldProbeContainer(lastHealthyAt, now)) return
		if (!(await probeContainerAlive(guest)))
			throw new Error(containerUnresponsiveMessage(containerName))
		lastHealthyAt = now
	}

	return {
		async exec(command, hostCwd, { onData, signal, timeout }) {
			const route = routeCommand(command, mountSource, workdir)
			if (route.side === 'host') {
				// No VM is involved, so nothing is probed and no guest path is mapped.
				onData(Buffer.from(HOST_GIT_NOTICE))
				return await hostOps.exec(
					route.command,
					hostCwd,
					hostExecOptions(onData, signal, timeout),
				)
			}
			const containerCwd = toContainerPath(mountSource, workdir, hostCwd)
			await ensureResponsive()
			const run = await execInContainer(guest, containerCwd, command, {
				onData,
				...streamOptions(signal, timeout, ownerSession),
			}).catch((error: unknown) => {
				throw new Error(containerExecFailure(guest, error))
			})
			return { exitCode: run.exitCode }
		},
	}
}
