// The /container status view: which guest backs the session, whether it
// answers, who else shares it, and what it is running right now. Read-only,
// and separate from container-command.ts so the verbs stay about acting and
// this stays about reporting to a human.
import { bestEffortContainerIp } from './container-address.ts'
import { probeContainerAlive } from './container.ts'
import { DEVVM_NAME } from './devvm.ts'
import {
	STALE_RECORD_GRACE_MS,
	execRecordDir,
	processIsAlive,
	readExecRecords,
	readSessionRecords,
	sessionRecordDir,
} from './exec-session.ts'
import {
	sandboxGateway,
	sandboxGuestTarget,
	sandboxWorkspace,
} from './runtime.ts'
import { GUEST_WORKDIR } from './sandbox-prompt.ts'

import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { GuestTarget } from './container.ts'
import type { SandboxWorkspace } from './wt.ts'

/** The guest the active session routes into; the probe falls back to the row's name. */
export function activeGuest(workspace: SandboxWorkspace): GuestTarget {
	return (
		sandboxGuestTarget() ?? {
			kind: 'container',
			containerName: workspace.containerName,
		}
	)
}

/** Who else is on this VM, and what it is running right now. */
function describeOwnership(
	containerName: string,
	ownSessionId: string,
): string[] {
	const others = readSessionRecords(sessionRecordDir()).filter(
		record =>
			record.containerName === containerName &&
			record.sessionId !== ownSessionId,
	)
	const attached = others.length
		? `Shared with ${others
				.map(
					record =>
						`${record.sessionId} (${processIsAlive(record.ownerPid) ? 'alive' : 'finished'}${record.branch ? `, ${record.branch}` : ''})`,
				)
				.join(', ')} - heavy jobs compete for its memory.`
		: 'No other pi session is attached to this VM.'
	const now = Date.now()
	const running = readExecRecords(execRecordDir(), containerName).filter(
		record =>
			processIsAlive(record.ownerPid) &&
			now < record.deadlineMs + STALE_RECORD_GRACE_MS,
	)
	const calls = running.length
		? `Running now: ${running.map(record => record.label || record.token).join('; ')}`
		: 'No guest call is running now.'
	return [attached, calls]
}

/** The identity line, forked by vehicle: a namespace is not a container. */
function identityLine(workspace: SandboxWorkspace): string {
	const { containerName, containerState, memory, vehicle } = workspace
	if (vehicle === 'devvm') {
		return `Namespace: ${containerName} on the shared dev VM ${DEVVM_NAME}`
	}
	const ip = bestEffortContainerIp(containerName)
	return `Container: ${containerName}  (${containerState}${memory ? `, ${memory}` : ''}${ip ? `, http://${ip}:<port>` : ''})`
}

/** What the workspace exposes to the host, by vehicle. */
function portsLine(workspace: SandboxWorkspace): string {
	if (workspace.vehicle === 'devvm') {
		return 'Serves on its tailnet node; nothing is published to the host from a namespace.'
	}
	if (workspace.ports.length > 0) {
		return `Published to the host: ${workspace.ports.join(', ')}`
	}
	return 'No ports published; use the container IP.'
}

/** How the guest reaches the host's services, as status reports it. */
function hostServicesLine(workspace: SandboxWorkspace): string {
	const gateway = sandboxGateway()
	if (gateway) return gateway
	if (workspace.vehicle === 'devvm') {
		return "wt's relays (the namespace has no other egress)"
	}
	return 'its default gateway, whichever address `ip route show default` reports'
}

export async function showStatus(
	ui: ExtensionContext['ui'],
	isDisabledByFlag: boolean,
	sessionId: string,
): Promise<void> {
	const workspace = sandboxWorkspace()
	if (!workspace) {
		ui.notify(
			`No sandbox active for this session${isDisabledByFlag ? ' (disabled by --no-container)' : ''}.\n` +
				`Bash runs on the host. wt decides containerization: container.activation in ~/.config/wt/config.json, or a .containerize marker / .pi/container.json in the repo.`,
			'info',
		)
		return
	}
	const { containerName, path, branch } = workspace
	// The runtime's own state is not liveness: a starved VM reports `running` and answers
	// nothing, so the probe is what this line is for.
	const answering = await probeContainerAlive(activeGuest(workspace))
	ui.notify(
		[
			identityLine(workspace),
			answering
				? 'VM: answering.'
				: 'VM: NOT answering (starved). Every exec hangs until it is restarted: /container restart.',
			`Workspace: ${path} (${branch}), mounted at ${GUEST_WORKDIR}`,
			portsLine(workspace),
			`Host services from the guest: ${hostServicesLine(workspace)}`,
			...describeOwnership(containerName, sessionId),
			'Abandoned guest work: /container reap. Rebuild it: /container restart. Stop: /container stop (a devvm stop is shared: it takes the whole VM down).',
		].join('\n'),
		'info',
	)
}
