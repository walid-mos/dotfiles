import { containerUnavailableReason, execInContainer } from './container'

import type { BashOperations } from '@earendil-works/pi-coding-agent'
import type { ExecStreamOptions } from './container'

/**
 * Exec-stream options built from pi's optional/node-bool values: strict
 * optional properties forbid explicit undefined, so unset keys are omitted
 * (a streamOptions helper keeps the exactOptionalPropertyTypes dance out of
 * the call site).
 */
function streamOptions(
	signal: AbortSignal | undefined,
	timeout: number | undefined,
): ExecStreamOptions | undefined {
	if (!signal && !timeout) return undefined
	const options: ExecStreamOptions = {}
	if (signal) options.signal = signal
	if (timeout) options.timeoutSeconds = timeout
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
		`Container sandbox: cannot access ${hostCwd} - only paths under the mounted project (${mountSource}) are available inside the container.`,
	)
}

export function createContainerBashOps(
	containerName: string,
	mountSource: string,
	workdir: string,
): BashOperations {
	return {
		async exec(command, hostCwd, { onData, signal, timeout }) {
			const containerCwd = toContainerPath(mountSource, workdir, hostCwd)
			const containerRun = await execInContainer(
				containerName,
				containerCwd,
				command,
				{ onData, ...streamOptions(signal, timeout) },
			).catch((err: unknown) => {
				throw new Error(containerUnavailableReason(err))
			})
			return { exitCode: containerRun.exitCode }
		},
	}
}
