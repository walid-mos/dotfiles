// Bash routing: pi's bash tool runs `container exec` in the workspace VM. Only
// the worktree is mounted (at /workspace), so host paths outside it have no
// container equivalent and are refused with an explanation the model can act on.
// Each call first checks that the VM still answers, so a starved VM fails with
// an actionable error instead of holding the turn until pi's timeout.
import {
	containerExecFailure,
	containerUnresponsiveMessage,
	execInContainer,
	probeContainerAlive,
} from './container.ts'

import type { BashOperations } from '@earendil-works/pi-coding-agent'
import type { ExecStreamOptions } from './container.ts'

/** A healthy VM answers in ~100 ms; a starved one never answers at all. */
const PROBE_FRESH_MS = 10_000

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

export function createContainerBashOps(
	containerName: string,
	mountSource: string,
	workdir: string,
	ownerSession: string,
): BashOperations {
	let lastHealthyAt: number | undefined

	const ensureResponsive = async (): Promise<void> => {
		const now = Date.now()
		if (!shouldProbeContainer(lastHealthyAt, now)) return
		if (!(await probeContainerAlive(containerName)))
			throw new Error(containerUnresponsiveMessage(containerName))
		lastHealthyAt = now
	}

	return {
		async exec(command, hostCwd, { onData, signal, timeout }) {
			const containerCwd = toContainerPath(mountSource, workdir, hostCwd)
			await ensureResponsive()
			const run = await execInContainer(
				containerName,
				containerCwd,
				command,
				{
					onData,
					...streamOptions(signal, timeout, ownerSession),
				},
			).catch((error: unknown) => {
				throw new Error(containerExecFailure(containerName, error))
			})
			return { exitCode: run.exitCode }
		},
	}
}
