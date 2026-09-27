// The active sandbox runtime: which wt workspace backs bash for this session,
// how the exec boundary reaches it, and how the model is told about it. The
// guest outlives the session on purpose - dev servers and dependency installs
// stay warm - so teardown stays explicit (wt clean, /container stop) and a
// session records itself in the workspace's state so a shared VM is never a
// surprise. session.ts owns when activation happens; this module owns what is
// active afterwards.
import {
	createBashTool,
	createLocalBashOperations,
} from '@earendil-works/pi-coding-agent'

import { createContainerBashOps } from './bash-ops.ts'
import {
	bestEffortContainerIp,
	bestEffortDevvmTailnetHost,
	bestEffortHostGateway,
	bestEffortTailnetHost,
} from './container-address.ts'
import { DEVVM_NAME, readDevvmTreePath } from './devvm.ts'
import { clearRecord, sessionRecordDir, writeRecord } from './exec-session.ts'
import { sandboxPromptSection } from './sandbox-prompt.ts'

import type {
	BashOperations,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { GuestTarget } from './container.ts'
import type { SandboxWorkspace } from './wt.ts'

interface SandboxRuntime {
	workspace: SandboxWorkspace
	sessionId: string
	/** How the exec boundary reaches this workspace: its own VM, or the dev VM. */
	guest: GuestTarget
	bashTool: ReturnType<typeof createBashTool>
	/**
	 * pi's local shell, which a bare git command uses instead of the VM: the repository
	 * lives on the host, and the mount carries only the worktree's files.
	 */
	hostOps: BashOperations
	/**
	 * The host as the VM addresses it, read once per activation because the runtime owns the
	 * bridge subnet. Null when the runtime cannot say: the prompt then points at the VM's own
	 * default route rather than naming an address nothing answers on.
	 */
	gateway: string | null
	/**
	 * The workspace's MagicDNS name as its own node reports it, null when it is not on the
	 * tailnet: the only address a human can open, read once per activation.
	 */
	tailnetHost: string | null
}

/**
 * The active runtime is published on globalThis, never kept in a module variable: jiti
 * loads every extension into its own module registry, so a second extension importing
 * this file gets a second copy whose module state is always empty - the seam would then
 * answer "no sandbox" while bash runs in the guest. One process, one realm, one
 * versioned key, the same idiom the renderers use.
 */
const RUNTIME_KEY = Symbol.for('pi.container-sandbox.runtime.v1')

/** The ui status key this extension publishes its line under; the footer's context line filters it. */
export const CONTAINER_STATUS_KEY = 'container-sandbox'

function isSandboxRuntime(candidate: unknown): candidate is SandboxRuntime {
	return (
		typeof candidate === 'object' &&
		candidate !== null &&
		'guest' in candidate &&
		'workspace' in candidate &&
		'sessionId' in candidate
	)
}

function currentRuntime(): SandboxRuntime | null {
	const published: unknown = Reflect.get(globalThis, RUNTIME_KEY)
	if (!isSandboxRuntime(published)) return null
	return published
}

/**
 * Whether the sandbox is active in this process, for surfaces outside this extension's
 * module registry (the footer's context line): their copy of this module has empty state,
 * but the globalThis publication is one realm, so the read is honest everywhere.
 */
export function sandboxActive(): boolean {
	return currentRuntime() !== null
}

// The workspace's context-line link, resolved once per activation (the tailnet
// name it embeds is one exec). The same globalThis realm as the runtime seam
// above; the footer's context line renders it as its [container] segment.
const LINK_KEY = Symbol.for('pi.container-sandbox.link.v1')

export function publishContainerLink(url: string | null): void {
	Reflect.set(globalThis, LINK_KEY, url)
}

/** The human-openable URL of the active workspace, or null when none answers. */
export function publishedContainerLink(): string | null {
	const published: unknown = Reflect.get(globalThis, LINK_KEY)
	if (typeof published !== 'string' || !published.length) return null
	return published
}

function publishRuntime(next: SandboxRuntime | null): void {
	Reflect.set(globalThis, RUNTIME_KEY, next)
}

/** One adapter, wired from the active runtime: the bash tool and `!` commands share it. */
function runtimeBashOps(
	workspace: SandboxWorkspace,
	guest: GuestTarget,
	sessionId: string,
	hostOps: BashOperations,
): BashOperations {
	return createContainerBashOps(
		{
			containerName: workspace.containerName,
			mountSource: workspace.path,
			workdir: '/workspace',
			ownerSession: sessionId,
			guest,
		},
		hostOps,
	)
}

/** Drop this session's claim on the workspace: the VM and its work stay warm for the next one. */
export function clearRuntimeState(): void {
	publishContainerLink(null)
	const active = currentRuntime()
	if (!active) return
	clearRecord(
		sessionRecordDir(),
		active.workspace.containerName,
		active.sessionId,
	)
	publishRuntime(null)
}

/**
 * Resolve how the exec boundary reaches this workspace. The one fact the devvm
 * chain cannot derive on its own is where the tree lives inside the VM: read
 * once here, never per call, and a workspace whose state is missing stays
 * unrouted instead of running against a guess.
 */
async function resolveGuest(
	workspace: SandboxWorkspace,
): Promise<GuestTarget | string> {
	if (workspace.vehicle !== 'devvm') {
		return { kind: 'container', containerName: workspace.containerName }
	}
	const treePath = await readDevvmTreePath(workspace.containerName)
	if (treePath) {
		return { kind: 'devvm', containerName: workspace.containerName, treePath }
	}
	return `Workspace ${workspace.containerName} has no tree recorded on the dev VM (${DEVVM_NAME}); run /container sync (or wt sync) and retry.`
}

/** The host as this guest addresses it: the bridge gateway for a container, none for a namespace. */
function gatewayFor(workspace: SandboxWorkspace): string | null {
	if (workspace.vehicle === 'devvm') return null
	return bestEffortHostGateway(workspace.containerName)
}

/** Write the session's claim and wire the bash tool; a failure text when it cannot. */
export async function activateRuntime(
	workspace: SandboxWorkspace,
	cwd: string,
	sessionId: string,
): Promise<string | null> {
	writeRecord(sessionRecordDir(), {
		sessionId,
		containerName: workspace.containerName,
		ownerPid: process.pid,
		worktree: workspace.path,
		branch: workspace.branch,
		startedAt: Date.now(),
	})
	// pi's local shell, created once: a bare git command borrows it for the whole session.
	const hostOps = createLocalBashOperations()
	const resolved = await resolveGuest(workspace)
	if (typeof resolved === 'string') return resolved
	const guest = resolved
	// Asked of the node itself, once per activation: the address this session hands a human is
	// the tailnet one, and a workspace that never answers simply has none.
	const tailnetHost =
		workspace.vehicle === 'devvm'
			? await bestEffortDevvmTailnetHost(workspace.containerName)
			: await bestEffortTailnetHost(workspace.containerName)
	publishRuntime({
		workspace,
		sessionId,
		guest,
		// The gateway is what a container relay dials; a namespace reaches the host
		// only through wt's relays, so it is honestly null there.
		gateway: gatewayFor(workspace),
		tailnetHost,
		hostOps,
		bashTool: createBashTool(cwd, {
			operations: runtimeBashOps(workspace, guest, sessionId, hostOps),
		}),
	})
	return null
}

/** `user_bash` payload: `!` commands run in the guest while the sandbox is active. */
export function userBashOperations():
	| { operations: BashOperations }
	| undefined {
	const operations = sandboxBashOperations()
	if (!operations) return undefined
	return { operations }
}

/**
 * The guest exec boundary for another extension to run work where the bash tool
 * runs it, or null while bash itself still runs on the host. Same adapter as the
 * bash tool - liveness guard, host-to-guest path mapping and error messages
 * included - so a consumer never reaches the `container` CLI on its own.
 */
export function sandboxBashOperations(): BashOperations | null {
	const active = currentRuntime()
	if (!active) return null
	return runtimeBashOps(
		active.workspace,
		active.guest,
		active.sessionId,
		active.hostOps,
	)
}

export function sandboxedBashTool(): ReturnType<typeof createBashTool> | null {
	return currentRuntime()?.bashTool ?? null
}

/**
 * pi's local shell as this session wired it, the one a bare `git` borrows: the boundary for a
 * host-side fact no guest call can read (the host's own git config, for the identity the VM
 * has none of). Null while bash runs on the host, where nothing has to be inherited.
 */
export function sandboxHostOperations(): BashOperations | null {
	return currentRuntime()?.hostOps ?? null
}

/** How the exec boundary reaches the active workspace, for the /container surface. */
export function sandboxGuestTarget(): GuestTarget | null {
	return currentRuntime()?.guest ?? null
}

/** The workspace this session routes into, for the /container surface. */
export function sandboxWorkspace(): SandboxWorkspace | null {
	return currentRuntime()?.workspace ?? null
}

/** The host as the VM addresses it, for the /container surface; null when unknown. */
export function sandboxGateway(): string | null {
	return currentRuntime()?.gateway ?? null
}

/** The workspace's own tailnet name, read at activation; null when it has none. */
export function sandboxTailnetHost(): string | null {
	return currentRuntime()?.tailnetHost ?? null
}

/** What the model must know about where its bash actually runs. */
export function sandboxSystemPromptSuffix(
	baseSystemPrompt: string,
): string | undefined {
	const active = currentRuntime()
	if (!active) return undefined
	const {
		containerName,
		vehicle,
		path,
		ports,
		memory,
		tailnetPorts,
		tailnetIndex,
	} = active.workspace
	return `${baseSystemPrompt}\n\n${sandboxPromptSection({
		containerName,
		vehicle,
		workspacePath: path,
		ports,
		memory,
		ip: bestEffortContainerIp(containerName),
		gateway: active.gateway,
		tailnetHost: active.tailnetHost,
		tailnetPorts,
		tailnetIndex,
	})}`
}

/** The footer line, forked by vehicle: a namespace is not a container. */
export function statusLine(workspace: SandboxWorkspace): string {
	const { containerName, vehicle } = workspace
	if (vehicle === 'devvm') {
		return `📦 devvm: ${containerName} on ${DEVVM_NAME}`
	}
	const ip = bestEffortContainerIp(containerName)
	return `📦 container: ${containerName}${ip ? ` (${ip})` : ''}`
}

/** The only port the context line links to. */
const CONTAINER_LINK_PORT = 9090

/**
 * The human-openable link for the context line: the workspace's tailnet address on the
 * declared port - the same rule the prompt teaches (sandbox-prompt.ts). The port counts as
 * declared whether the project lists it in `tailscale.ports` or reserves it as wt's own
 * `tailscale.index` (always served there). A workspace off the tailnet, or with the port
 * undeclared, gets a plain label instead of a URL nothing answers on.
 */
export function containerLink(
	workspace: SandboxWorkspace,
	tailnetHost: string | null,
): string | null {
	if (!tailnetHost) return null
	const isDeclaredPort =
		workspace.tailnetPorts.includes(CONTAINER_LINK_PORT) ||
		workspace.tailnetIndex === CONTAINER_LINK_PORT
	if (!isDeclaredPort) return null
	return `https://${tailnetHost}:${CONTAINER_LINK_PORT}`
}

/** The session file's name, which identifies this session across restarts. */
export function sessionIdFromContext(ctx: ExtensionContext): string {
	const file = ctx.sessionManager.getSessionFile()
	const name = file?.split('/').pop() ?? ''
	return name ? name.replace(/\.jsonl$/u, '') : `pid-${process.pid}`
}
