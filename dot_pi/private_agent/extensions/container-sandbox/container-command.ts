import { activeGuest, showStatus } from './container-status.ts'
// The /container command surface: the recovery verbs (sync, reap, restart,
// stop) and the dispatch. The status report lives in container-status.ts, so
// this file stays about acting; both read the runtime through runtime.ts.
import {
	reapAbandonedGuestSessions,
	restartContainerRuntime,
	stopContainer,
} from './container.ts'
import { DEVVM_NAME } from './devvm.ts'
import { clearContainerUnresponsive } from './liveness.ts'
import {
	activateRuntime,
	sandboxWorkspace,
	sessionIdFromContext,
} from './runtime.ts'
import {
	ensureContainerRunning,
	ensureDevvmRunning,
} from './sync.ts'
import { probeWorkspace } from './wt.ts'
import {
	ensureContainerConfig,
	fixContainerConfig,
	isInvalidConfig,
} from './container-config.ts'
import { sourceRepoRoot } from './container-config-facts.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { SandboxWorkspace } from './wt.ts'
import type { SyncOutcome } from './sync.ts'

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

async function handleStop(ui: ExtensionContext['ui']): Promise<void> {
	const workspace = sandboxWorkspace()
	if (!workspace) {
		ui.notify('No container sandbox running for this session.', 'info')
		return
	}
	const { containerName, vehicle } = workspace
	// The dev VM is shared: stopping it takes every workspace on it down, so the
	// scoped verbs live with wt, which owns the lifecycle.
	if (vehicle === 'devvm') {
		ui.notify(
			`${containerName} is a namespace on ${DEVVM_NAME}; stopping the VM stops every workspace on it. Use wt clean (the checkout) or wt devvm remove ${containerName} for this workspace alone, or 'container stop ${DEVVM_NAME}' with that intent.`,
			'info',
		)
		return
	}
	const stopped = await stopContainer(containerName)
	if (stopped.exitCode === -1) {
		ui.notify(
			`${containerName} did not answer its own stop: its VM is starved, and a starved VM holds the runtime for every container on this machine. /container restart clears it from the host side.`,
			'error',
		)
		return
	}
	ui.notify(
		stopped.exitCode === 0
			? `Stopped ${containerName}. /container sync brings it back.`
			: `Cannot stop ${containerName}: ${stopped.stderr.trim() || 'unknown error'}`,
		stopped.exitCode === 0 ? 'info' : 'error',
	)
}

/** A VM that ignores even `stop` is a runtime-level wedge: escalate, then rebuild the row. */
async function handleRestart(
	ui: ExtensionContext['ui'],
	workspace: SandboxWorkspace | null,
	ctx: ExtensionContext,
	sessionId: string,
): Promise<void> {
	if (!workspace) {
		ui.notify(
			'No containerized workspace here; nothing to restart.',
			'info',
		)
		return
	}
	const { containerName, vehicle } = workspace
	// What "stop" means depends on the vehicle: the workspace's own VM, or
	// the shared dev VM every workspace on this machine lives on.
	const stopped = await stopContainer(
		vehicle === 'devvm' ? DEVVM_NAME : containerName,
	)
	if (stopped.exitCode === -1) {
		if (!(await restartContainerRuntime())) {
			ui.notify(
				`${containerName} is starved and the container runtime would not restart. Run \`container system stop && container system start\`, then /container sync.`,
				'error',
			)
			return
		}
		ui.notify(
			`${containerName} would not stop (starved VM, which holds the whole runtime), so the container runtime was restarted host-side. Other workspaces are stopped until /container sync; this one is coming back now.`,
			'info',
		)
	}
	// Whatever a probe said before, the workspace is being rebuilt now.
	clearContainerUnresponsive(containerName)
	const outcome = await reconcileAfterConfigFix(workspace, ctx)
	if (outcome.failure) {
		ui.notify(`Restart failed: ${outcome.failure}`, 'error')
		return
	}
	const activation = await activateRuntime(workspace, ctx.cwd, sessionId)
	if (activation) {
		ui.notify(`Restart failed: ${activation}`, 'error')
		return
	}
	ui.notify(`Restarted ${containerName}.`, 'info')
}

/** The vehicle's own reconcile: a container starts or rebuilds, a namespace re-adds. */
async function reconcile(workspace: SandboxWorkspace): Promise<SyncOutcome> {
	if (workspace.vehicle === 'devvm') return ensureDevvmRunning(workspace.path)
	return ensureContainerRunning({ ...workspace, containerState: 'stopped' })
}

/** Reconcile with the config fix in front of creation: a repo with no
 * .pi/container.json gets one derived before the container is born, and a
 * declaration wt rejects is regenerated (no confirmation - wt condemned it)
 * before the sync is retried once. */
async function reconcileAfterConfigFix(
	workspace: SandboxWorkspace,
	ctx: ExtensionContext,
): Promise<SyncOutcome> {
	const creating = workspace.containerState !== 'running'
	if (creating && workspace.repo) {
		await ensureContainerConfig(workspace.repo, ctx)
	}
	const outcome = await reconcile(workspace)
	if (!isInvalidConfig(outcome.failure) || !workspace.repo) return outcome
	const fix = await fixContainerConfig(workspace.repo, ctx, {
		wtRejected: outcome.failure ?? undefined,
	})
	return fix.kind === 'written' ? reconcile(workspace) : outcome
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
		const reaped = await reapAbandonedGuestSessions(activeGuest(workspace))
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
	ctx: ExtensionContext,
	sessionId: string,
): Promise<void> {
	if (!workspace) {
		ui.notify('No containerized workspace here; nothing to sync.', 'info')
		return
	}
	const outcome = await reconcileAfterConfigFix(workspace, ctx)
	if (!outcome.failure) {
		clearContainerUnresponsive(workspace.containerName)
		const activation = await activateRuntime(workspace, ctx.cwd, sessionId)
		if (activation) {
			ui.notify(`Sync failed: ${activation}`, 'error')
			return
		}
	}
	ui.notify(
		outcome.failure
			? `Sync failed: ${outcome.failure}`
			: `${workspace.containerName} is running.${refreshText(outcome)}`,
		outcome.failure ? 'error' : 'info',
	)
}

/** Derive the declaration on demand: an existing file is only replaced when
 * the operator confirms it. */
async function handleFix(
	ui: ExtensionContext['ui'],
	workspace: SandboxWorkspace | null,
	ctx: ExtensionContext,
): Promise<void> {
	const repoRoot = workspace?.repo || (await sourceRepoRoot(ctx.cwd))
	if (!repoRoot) {
		ui.notify('No repository here; nothing to derive a container config for.', 'error')
		return
	}
	const fix = await fixContainerConfig(repoRoot, ctx)
	if (fix.kind === 'failed') ui.notify(`Config fix failed: ${fix.reason}`, 'error')
	else if (fix.kind === 'kept') ui.notify('The current .pi/container.json stays.', 'info')
}
function refreshText(outcome: SyncOutcome): string {
	if (!outcome.adoptedKeys.length) return ''
	const adopted = outcome.adoptedKeys.join(', ')
	return outcome.recreated
		? ` Adopted ${adopted} from .pi/container.json; container recreated.`
		: ` Adopted ${adopted} from .pi/container.json.`
}

/** `/container` dispatch: status · sync · reap · restart · stop. */
export async function containerCommandHandler(
	args: string,
	ctx: ExtensionContext,
	pi: ExtensionAPI,
): Promise<void> {
	const subcommand = args.trim()
	const sessionId = sessionIdFromContext(ctx)
	const probe = await probeWorkspace(ctx.cwd)
	const workspace =
		probe.lookup.kind === 'containerized' ? probe.lookup.workspace : null
	switch (subcommand) {
		case '':
		case 'status':
			await showStatus(
				ctx.ui,
				pi.getFlag('no-container') === true,
				sessionId,
			)
			return
		case 'sync':
			await handleSync(ctx.ui, workspace, ctx, sessionId)
			return
		case 'reap':
			await handleReap(ctx.ui, workspace)
			return
		case 'restart':
			await handleRestart(ctx.ui, workspace, ctx, sessionId)
			return
		case 'fix':
			await handleFix(ctx.ui, workspace, ctx)
			return
		case 'stop':
			await handleStop(ctx.ui)
			return
		default:
			ctx.ui.notify(
				'Usage: /container [status|sync|reap|restart|fix|stop]',
				'info',
				)
	}
}
