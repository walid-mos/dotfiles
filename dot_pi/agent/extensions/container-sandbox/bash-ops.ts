import type { BashOperations } from "@earendil-works/pi-coding-agent";
import { containerUnavailableReason, execInContainer } from "./container";

export function toContainerPath(mountSource: string, workdir: string, hostCwd: string): string {
	if (hostCwd === mountSource) return workdir;
	if (hostCwd.startsWith(mountSource + "/")) {
		return workdir + hostCwd.slice(mountSource.length);
	}
	throw new Error(
		`Container sandbox: cannot access ${hostCwd} — only paths under the mounted project (${mountSource}) are available inside the container.`,
	);
}

export function createContainerBashOps(
	containerName: string,
	mountSource: string,
	workdir: string,
): BashOperations {
	return {
		async exec(command, hostCwd, { onData, signal, timeout }) {
			const containerCwd = toContainerPath(mountSource, workdir, hostCwd);
			const result = await execInContainer(containerName, containerCwd, command, {
				onData,
				signal,
				timeoutSeconds: timeout,
			}).catch((err: unknown) => {
				throw new Error(containerUnavailableReason(err));
			});
			return { exitCode: result.exitCode };
		},
	};
}