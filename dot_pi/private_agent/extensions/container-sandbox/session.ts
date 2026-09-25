// The session lifecycle of the sandbox: probe the workspace, make sure it is
// running, activate the runtime (runtime.ts), reap abandoned guest work, and
// tell the model and the human what happened. The guest outlives the session
// on purpose - dev servers and dependency installs stay warm - so nothing here
// tears anything down. The /container surface lives in container-command.ts.
import { guestTouchCommand } from './bash-ops.ts'
import {
	devvmWorkspaceAnswering,
	execInContainer,
	reapAbandonedGuestSessions,
} from './container.ts'
import { DEVVM_NAME, devvmEnvironmentPublished } from './devvm.ts'
import { inheritGuestGitIdentity } from './guest-git.ts'
import { containerRecentlyUnresponsive } from './liveness.ts'
import {
	activateRuntime,
	containerLink,
	CONTAINER_STATUS_KEY,
	publishContainerLink,
	sandboxGuestTarget,
	sandboxHostOperations,
	sandboxTailnetHost,
	sandboxWorkspace,
	sessionIdFromContext,
	statusLine,
} from './runtime.ts'
import { GUEST_WORKDIR } from './sandbox-prompt.ts'
import {
	ensureContainerRunning,
	ensureDevvmRunning,
} from './sync.ts'
import {
	probeWorkspace,
} from './wt.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { GuestTarget } from './container.ts'
import type { SandboxWorkspace } from './wt.ts'

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

/**
 * A post-edit touch only has to wake an in-VM watcher: a VM that cannot do that within
 * seconds is not answering, and the touch is best effort either way.
 */
const TOUCH_DEADLINE_SECONDS = 15

/**
 * Wake the VM's own watchers after a host-side edit. virtiofs delivers no event for a host
 * write, so an in-VM vite/tsx watcher stays stale through exactly the edits an agent makes;
 * the guest touching the file is the notification it can see. Best effort by design: the
 * touch changes nothing about the tool result, and a VM beyond answering must not fail it.
 */
export function notifyGuestOfHostEdit(edit: {
	toolName: string
	input: Record<string, unknown>
	isError: boolean
}): void {
	const active = guestTargetFromRuntime()
	if (!active) return
	const command = guestTouchCommand(
		active.workspace.path,
		GUEST_WORKDIR,
		edit,
	)
	if (!command) return
	// A starved VM is not woken: the touch is best effort, and queueing one behind a hang
	// costs the session a client it never gets an answer from.
	if (containerRecentlyUnresponsive(active.workspace.containerName)) return
	void (async (): Promise<void> => {
		try {
			await execInContainer(active.guest, GUEST_WORKDIR, command, {
				timeoutSeconds: TOUCH_DEADLINE_SECONDS,
			})
		} catch {
			// Best effort: a VM that never answers must not change the tool result.
		}
	})()
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
	// A devvm workspace has no state machine to consult: the add is the state, so
	// the cheapest honest check is one exec through its namespace. It never boots
	// a stopped VM (exec fails instead), and a workspace that answers is ready.
	const failure = await ensureSession(workspace)
	if (failure) {
		ctx.ui.notify(`Container sandbox failed: ${failure}`, 'error')
		return
	}
	const sessionId = sessionIdFromContext(ctx)
	const activation = await activateRuntime(workspace, ctx.cwd, sessionId)
	if (activation) {
		ctx.ui.notify(`Container sandbox failed: ${activation}`, 'error')
		return
	}
	const guest = sandboxGuestTarget()
	if (guest) reapForSession(ctx, guest)
	const status = ctx.ui.theme.fg('accent', statusLine(workspace))
	ctx.ui.setStatus(CONTAINER_STATUS_KEY, status)
	publishContainerLink(containerLink(workspace, sandboxTailnetHost()))
	notifyActivated(ctx, workspace)
	await inheritGitIdentity(ctx, workspace, sessionId)
	if (workspace.vehicle === 'devvm') publishDevvmEnvironment(ctx, workspace)
}

/**
 * No VM carries the host's ~/.gitconfig - the share starts at the worktree's parent, never at
 * the home directory - so the identity a commit needs is inherited before the session's first
 * command (guest-git.ts owns what is written and how it is compared). Best effort in the sense
 * that matters here: a VM that never answers must not fail the session, so the outcome is a
 * notice. Nothing to inherit is silent - the host has no identity either, which is the human's
 * own git configuration to fix, not an identity for a session to invent.
 */
async function inheritGitIdentity(
	ctx: ExtensionContext,
	workspace: SandboxWorkspace,
	sessionId: string,
): Promise<void> {
	const hostOps = sandboxHostOperations()
	const guest = sandboxGuestTarget()
	if (!hostOps || !guest) return
	// A starved VM is not queued behind: the session activates without it, and every later
	// call fails at once with the recovery it needs.
	if (containerRecentlyUnresponsive(workspace.containerName)) return
	try {
		const outcome = await inheritGuestGitIdentity({
			hostOps,
			worktreePath: workspace.path,
			guest,
			workdir: GUEST_WORKDIR,
			ownerSession: sessionId,
		})
		if (outcome.kind !== 'inherited') return
		ctx.ui.notify(
			`Inherited the host's git identity into ${workspace.containerName} (git config --global user.name/user.email).`,
			'info',
		)
	} catch (error) {
		ctx.ui.notify(
			`Could not inherit the host's git identity into ${workspace.containerName}: ${describe(error)}`,
			'info',
		)
	}
}

/** The vehicle's own "make sure it runs": a container starts, a namespace answers or re-adds. */
async function ensureSession(
	workspace: SandboxWorkspace,
): Promise<string | null> {
	if (workspace.vehicle === 'devvm') {
		if (await devvmWorkspaceAnswering(workspace.containerName)) return null
		const outcome = await ensureDevvmRunning(workspace.path)
		return outcome.failure
	}
	if (workspace.containerState === 'running') return null
	const outcome = await ensureContainerRunning(workspace)
	return outcome.failure
}

/**
 * A devvm workspace's environment is a fact wt publishes into the VM, and the exec
 * boundary sources it, so a server started through bash answers on the workspace's own
 * tailnet name. A workspace wt never published one for - added before it learned to - is
 * reconciled through wt itself, the way a stopped namespace is: `wt sync` is the
 * idempotent add. Best effort by design, and never fatal: routing into a workspace must
 * not depend on a file it can live without, so the outcome is a notice.
 */
function publishDevvmEnvironment(
	ctx: ExtensionContext,
	workspace: SandboxWorkspace,
): void {
	void (async (): Promise<void> => {
		try {
			if (await devvmEnvironmentPublished(workspace.containerName)) return
			const failure = await ensureDevvmRunning(workspace.path)
			if (
				!failure &&
				(await devvmEnvironmentPublished(workspace.containerName))
			) {
				ctx.ui.notify(
					`Published the workspace environment of ${workspace.containerName} (wt sync).`,
					'info',
				)
				return
			}
			ctx.ui.notify(
				`${workspace.containerName} has no published workspace environment${failure ? `: ${failure}` : ''}; a dev server may refuse its tailnet URL until wt sync succeeds.`,
				'info',
			)
		} catch (error) {
			ctx.ui.notify(
				`Could not check the workspace environment of ${workspace.containerName}: ${describe(error)}`,
				'info',
			)
		}
	})()
}

/** Where bash runs and where the work is served, said once per activation. */
function notifyActivated(
	ctx: ExtensionContext,
	workspace: SandboxWorkspace,
): void {
	const { containerName, vehicle, tailnetIndex } = workspace
	// The link a human can open is the tailnet one, never the VM's own address: the notification
	// says where bash runs, and where the work they can look at is served.
	const tailnetHost = sandboxTailnetHost()
	const page =
		tailnetHost && tailnetIndex
			? ` Workspace index: https://${tailnetHost}:${tailnetIndex}`
			: ''
	const where =
		vehicle === 'devvm'
			? `namespace ${containerName} on the shared dev VM (${DEVVM_NAME})`
			: `${containerName}${workspace.memory ? ` [${workspace.memory}]` : ''}`
	ctx.ui.notify(
		`Bash runs inside ${where} - the worktree is mounted at ${GUEST_WORKDIR}.${page}`,
		'info',
	)
}

/** The active runtime's routing facts, for the touch bridge above. */
function guestTargetFromRuntime(): {
	workspace: SandboxWorkspace
	guest: GuestTarget
} | null {
	const workspace = sandboxWorkspace()
	if (!workspace) return null
	const guest = sandboxGuestTarget()
	if (!guest) return null
	return { workspace, guest }
}

/**
 * Kill work a dead session left in this guest before adding to it. Best effort by
 * design: the VM may be beyond answering, and that failure must not block the session, so
 * the result is reported and never awaited.
 */
function reapForSession(ctx: ExtensionContext, guest: GuestTarget): void {
	void (async (): Promise<void> => {
		try {
			const reaped = await reapAbandonedGuestSessions(guest)
			if (!reaped) return
			ctx.ui.notify(
				`Killed ${reaped} abandoned guest call(s) left in ${guest.containerName} by a finished session.`,
				'info',
			)
		} catch (error) {
			ctx.ui.notify(
				`Could not check ${guest.containerName} for abandoned guest work: ${describe(error)}`,
				'info',
			)
		}
	})()
}
