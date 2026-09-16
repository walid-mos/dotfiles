// Per-session sandbox state: which wt container backs bash for this session,
// how it is addressed, and how the model is told about it. The container
// outlives the session on purpose - dev servers and dependency installs stay
// warm - so teardown stays explicit (wt clean, /container stop), abandoned
// guest work is reaped by ownership (/container reap), and a session records
// itself in the container's state so a shared VM is never a surprise. The
// /container surface itself lives in container-command.ts.
import { createBashTool } from '@earendil-works/pi-coding-agent'

import { createContainerBashOps } from './bash-ops.ts'
import {
	bestEffortContainerIp,
	bestEffortHostGateway,
	reapAbandonedGuestSessions,
} from './container.ts'
import { clearRecord, sessionRecordDir, writeRecord } from './exec-session.ts'
import { ensureContainerRunning, probeWorkspace } from './wt.ts'

import type {
	BashOperations,
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { SandboxWorkspace } from './wt.ts'

export const GUEST_WORKDIR = '/workspace'

interface SandboxRuntime {
	workspace: SandboxWorkspace
	sessionId: string
	bashTool: ReturnType<typeof createBashTool>
	/**
	 * The host as the VM addresses it, read once per activation because the runtime owns the
	 * bridge subnet. Null when the runtime cannot say: the prompt then points at the VM's own
	 * default route rather than naming an address nothing answers on.
	 */
	gateway: string | null
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

let runtime: SandboxRuntime | null = null

/**
 * The session file names the pi session across restarts, which is what makes ownership
 * readable in another session's /container status; a session without a file is identified
 * by the pi process that owns it.
 */
export function resolveSessionId(ctx: ExtensionContext): string {
	const file = ctx.sessionManager.getSessionFile()
	const name = file?.split('/').pop() ?? ''
	return name ? name.replace(/\.jsonl$/u, '') : `pid-${process.pid}`
}

/** Drop this session's claim on the container: the VM and its work stay warm for the next one. */
export function clearRuntimeState(): void {
	if (!runtime) return
	clearRecord(
		sessionRecordDir(),
		runtime.workspace.containerName,
		runtime.sessionId,
	)
	runtime = null
}

export function activateRuntime(
	workspace: SandboxWorkspace,
	cwd: string,
	sessionId: string,
): void {
	writeRecord(sessionRecordDir(), {
		sessionId,
		containerName: workspace.containerName,
		ownerPid: process.pid,
		worktree: workspace.path,
		branch: workspace.branch,
		startedAt: Date.now(),
	})
	runtime = {
		workspace,
		sessionId,
		gateway: bestEffortHostGateway(workspace.containerName),
		bashTool: createBashTool(cwd, {
			operations: createContainerBashOps(
				workspace.containerName,
				workspace.path,
				GUEST_WORKDIR,
				sessionId,
			),
		}),
	}
}

/** `user_bash` payload: `!` commands run in the VM while the sandbox is active. */
export function userBashOperations():
	| { operations: BashOperations }
	| undefined {
	if (!runtime) return undefined
	return {
		operations: createContainerBashOps(
			runtime.workspace.containerName,
			runtime.workspace.path,
			GUEST_WORKDIR,
			runtime.sessionId,
		),
	}
}

export function sandboxedBashTool(): ReturnType<typeof createBashTool> | null {
	return runtime?.bashTool ?? null
}

/** The workspace this session routes into, for the /container surface. */
export function sandboxWorkspace(): SandboxWorkspace | null {
	return runtime?.workspace ?? null
}

/** The host as the VM addresses it, for the /container surface; null when unknown. */
export function sandboxGateway(): string | null {
	return runtime?.gateway ?? null
}

/** What the model must know about where its bash actually runs. */
export function sandboxSystemPromptSuffix(
	baseSystemPrompt: string,
): string | undefined {
	if (!runtime) return undefined
	const { containerName, path, ports, memory } = runtime.workspace
	const ip = bestEffortContainerIp(containerName)
	const portLine =
		ports.length > 0 ? ` also on the host at ${ports.join(', ')}` : ''
	const hostServices = runtime.gateway
		? `The project's host-side services (database, Keycloak, MinIO) are relayed by wt onto this VM's own localhost, so address them as localhost:<port>; anything wt does not relay is reachable at ${runtime.gateway}:<port>.`
		: `The project's host-side services are relayed by wt onto this VM's own localhost, so address them as localhost:<port>; anything wt does not relay is reachable through the VM's default gateway, whichever address \`ip route show default\` reports.`
	return `${baseSystemPrompt}

## Sandbox environment
Bash commands run inside an Apple container VM (\`${containerName}\`), NOT on the macOS host. The worktree ${path} is mounted at ${GUEST_WORKDIR} and the current directory is already inside it; nothing else of the host exists there (/Users, /Applications, brew, osascript, the macOS home). Use the \`host\` tool for macOS administration, and the read/edit/write tools for project files.
The VM has its own localhost, ports and network stack, so servers started here never conflict with other workspaces. A server the host must reach at http://${ip ?? '<container-ip>'}:<port> has to listen on 0.0.0.0, not only loopback${portLine}. ${hostServices}
Commands left running here compete with every later one for a small VM${memory ? ` (${memory})` : ''}, and a starved VM stops answering altogether: never keep a dev server next to a full typecheck or build, and detach long work instead of waiting on it. Every pi session whose worktree maps to this container shares the same VM, so check /container status before starting heavy work; a call that times out or is interrupted is killed with its whole guest process tree, which is why nothing may be left running by accident.`
}

function statusLine(workspace: SandboxWorkspace): string {
	const { containerName } = workspace
	const ip = bestEffortContainerIp(containerName)
	return `📦 container: ${containerName}${ip ? ` (${ip})` : ''}`
}

/** Provision the sandbox for this session: resolve the row, make sure it runs. */
export async function startSandboxSession(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
): Promise<void> {
	if (pi.getFlag('no-container') === true) return
	const probe = await probeWorkspace(ctx.cwd)
	if (probe.lookup.kind !== 'containerized') {
		if (probe.reason)
			ctx.ui.notify(`Container sandbox off: ${probe.reason}`, 'info')
		return
	}
	const { workspace } = probe.lookup
	if (workspace.containerState !== 'running') {
		ctx.ui.notify(
			`Container sandbox: ${workspace.containerState} container, asking wt sync…`,
			'info',
		)
	}
	const failure = await ensureContainerRunning(workspace)
	if (failure) {
		ctx.ui.notify(`Container sandbox failed: ${failure}`, 'error')
		return
	}
	const sessionId = resolveSessionId(ctx)
	activateRuntime(workspace, ctx.cwd, sessionId)
	reapForSession(ctx, workspace.containerName)
	ctx.ui.setStatus(
		'container-sandbox',
		ctx.ui.theme.fg('accent', statusLine(workspace)),
	)
	const { containerName } = workspace
	const ip = bestEffortContainerIp(containerName)
	ctx.ui.notify(
		`Bash runs inside ${containerName}${memorySuffix(workspace)}${ip ? ` (host access: http://${ip}:<port>)` : ''} - the worktree is mounted at ${GUEST_WORKDIR}.`,
		'info',
	)
}

function memorySuffix(workspace: SandboxWorkspace): string {
	return workspace.memory ? ` [${workspace.memory}]` : ''
}

/**
 * Kill work a dead session left in this container before adding to it. Best effort by
 * design: the VM may be beyond answering, and that failure must not block the session, so
 * the result is reported and never awaited.
 */
function reapForSession(ctx: ExtensionContext, containerName: string): void {
	void (async (): Promise<void> => {
		try {
			const reaped = await reapAbandonedGuestSessions(containerName)
			if (!reaped) return
			ctx.ui.notify(
				`Killed ${reaped} abandoned guest call(s) left in ${containerName} by a finished session.`,
				'info',
			)
		} catch (error) {
			ctx.ui.notify(
				`Could not check ${containerName} for abandoned guest work: ${describe(error)}`,
				'info',
			)
		}
	})()
}

/** Who else is on this VM, and what it is running right now. */
