// The /container command surface: what the sandbox is doing right now (container,
// workspace, memory, who else shares the VM, what is running in it) and the explicit
// recovery verbs. Kept apart from session.ts so the runtime module stays about activating
// and describing a sandbox, and this one about reporting it to a human.
import {
	bestEffortContainerIp,
	reapAbandonedGuestSessions,
	stopContainer,
} from './container.ts'
import {
	STALE_RECORD_GRACE_MS,
	execRecordDir,
	processIsAlive,
	readExecRecords,
	readSessionRecords,
	sessionRecordDir,
} from './exec-session.ts'
import {
	GUEST_WORKDIR,
	activateRuntime,
	resolveSessionId,
	sandboxGateway,
	sandboxWorkspace,
} from './session.ts'
import { ensureContainerRunning, probeWorkspace } from './wt.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { SandboxWorkspace } from './wt.ts'

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
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

function showStatus(
	ui: ExtensionContext['ui'],
	isDisabledByFlag: boolean,
	sessionId: string,
): void {
	const workspace = sandboxWorkspace()
	if (!workspace) {
		ui.notify(
			`No sandbox active for this session${isDisabledByFlag ? ' (disabled by --no-container)' : ''}.\n` +
				`Bash runs on the host. wt decides containerization: container.activation in ~/.config/wt/config.json, or a .containerize marker / .pi/container.json in the repo.`,
			'info',
		)
		return
	}
	const { containerName, path, branch, containerState, ports, memory } =
		workspace
	const ip = bestEffortContainerIp(containerName)
	ui.notify(
		[
			`Container: ${containerName}  (${containerState}${memory ? `, ${memory}` : ''}${ip ? `, http://${ip}:<port>` : ''})`,
			`Workspace: ${path} (${branch}), mounted at ${GUEST_WORKDIR}`,
			ports.length > 0
				? `Published to the host: ${ports.join(', ')}`
				: 'No ports published; use the container IP.',
			`Host services from the VM: ${sandboxGateway() ?? 'its default gateway, whichever address `ip route show default` reports'}`,
			...describeOwnership(containerName, sessionId),
			'Abandoned guest work: /container reap. Stop it: /container stop. Rebuild it: /container restart.',
		].join('\n'),
		'info',
	)
}

async function handleStop(ui: ExtensionContext['ui']): Promise<void> {
	const workspace = sandboxWorkspace()
	if (!workspace) {
		ui.notify('No container sandbox running for this session.', 'info')
		return
	}
	const { containerName } = workspace
	const stopped = await stopContainer(containerName)
	ui.notify(
		stopped.exitCode === 0
			? `Stopped ${containerName}. /container sync brings it back.`
			: `Cannot stop ${containerName}: ${stopped.stderr.trim() || 'unknown error'}`,
		stopped.exitCode === 0 ? 'info' : 'error',
	)
}

/** A starved VM answers nothing, not even /container stop, so a rebuild is the way out. */
async function handleRestart(
	ui: ExtensionContext['ui'],
	workspace: SandboxWorkspace | null,
	cwd: string,
	sessionId: string,
): Promise<void> {
	if (!workspace) {
		ui.notify(
			'No containerized workspace here; nothing to restart.',
			'info',
		)
		return
	}
	await stopContainer(workspace.containerName)
	const failure = await ensureContainerRunning({
		...workspace,
		containerState: 'stopped',
	})
	if (failure) {
		ui.notify(`Restart failed: ${failure}`, 'error')
		return
	}
	activateRuntime(workspace, cwd, sessionId)
	ui.notify(`Restarted ${workspace.containerName}.`, 'info')
}

async function handleReap(
	ui: ExtensionContext['ui'],
	workspace: SandboxWorkspace | null,
): Promise<void> {
	if (!workspace) {
		ui.notify('No containerized workspace here; nothing to reap.', 'info')
		return
	}
	try {
		const reaped = await reapAbandonedGuestSessions(workspace.containerName)
		ui.notify(
			reaped === 0
				? 'No abandoned guest work: every call still running belongs to a live session.'
				: `Reaped ${reaped} abandoned guest call(s); the VM has its memory back.`,
			'info',
		)
	} catch (error) {
		ui.notify(`Reap failed: ${describe(error)}`, 'error')
	}
}

async function handleSync(
	ui: ExtensionContext['ui'],
	workspace: SandboxWorkspace | null,
	cwd: string,
	sessionId: string,
): Promise<void> {
	if (!workspace) {
		ui.notify('No containerized workspace here; nothing to sync.', 'info')
		return
	}
	const failure = await ensureContainerRunning(workspace)
	if (!failure) activateRuntime(workspace, cwd, sessionId)
	ui.notify(
		failure
			? `Sync failed: ${failure}`
			: `${workspace.containerName} is running.`,
		failure ? 'error' : 'info',
	)
}

/** `/container` dispatch: status · sync · reap · restart · stop. */
export async function containerCommandHandler(
	args: string,
	ctx: ExtensionContext,
	pi: ExtensionAPI,
): Promise<void> {
	const subcommand = args.trim()
	const sessionId = resolveSessionId(ctx)
	const probe = await probeWorkspace(ctx.cwd)
	const workspace =
		probe.lookup.kind === 'containerized' ? probe.lookup.workspace : null
	switch (subcommand) {
		case '':
		case 'status':
			showStatus(ctx.ui, pi.getFlag('no-container') === true, sessionId)
			return
		case 'sync':
			await handleSync(ctx.ui, workspace, ctx.cwd, sessionId)
			return
		case 'reap':
			await handleReap(ctx.ui, workspace)
			return
		case 'restart':
			await handleRestart(ctx.ui, workspace, ctx.cwd, sessionId)
			return
		case 'stop':
			await handleStop(ctx.ui)
			return
		default:
			ctx.ui.notify(
				'Usage: /container [status|sync|reap|restart|stop]',
				'info',
			)
	}
}
