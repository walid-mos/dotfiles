// Per-session runtime state of the container sandbox: which container backs
// bash for this session and how it is reached, plus the status/stop command
// surface and the provisioning helpers.
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { createBashTool } from '@earendil-works/pi-coding-agent'

import { createContainerBashOps } from './bash-ops'
import { loadConfig, resolveContainerName, resolveMountSource } from './config'
import {
	bestEffortContainerIp,
	containerExists,
	containerUnavailableReason,
	createContainer,
	isContainerAvailable,
	isContainerRunning,
	startExistingContainer,
	stopContainer,
} from './container'
import { markWorktree } from './marker'

import type {
	BashOperations,
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { ContainerSandboxConfig } from './config'

type RuntimeState = {
	containerName: string
	mountSource: string
	workdir: string
}

type SandboxBashTool = ReturnType<typeof createBashTool>

// Module state: this extension is bound once per pi process, like the
// adapter map in ordered-widget-stack.
let runtimeState: RuntimeState | null = null
let sandboxedBash: SandboxBashTool | null = null

export function hasActiveRuntime(): boolean {
	return runtimeState !== null && sandboxedBash !== null
}

export function setRuntimeState(
	state: RuntimeState,
	bashTool: SandboxBashTool,
): void {
	runtimeState = state
	sandboxedBash = bashTool
}

// Intentionally keep the container running across sessions: sessions resume
// and dev servers survive. Use /container stop for explicit teardown.
export function clearRuntimeState(): void {
	runtimeState = null
}

export function runSandboxedOrLocal(
	localBash: SandboxBashTool,
	execArgs: Parameters<SandboxBashTool['execute']>,
): ReturnType<SandboxBashTool['execute']> {
	if (!runtimeState || !sandboxedBash) {
		return localBash.execute(...execArgs)
	}
	return sandboxedBash.execute(...execArgs)
}

/** `user_bash` payload: containerized operations while the sandbox runs. */
export function userBashResult(): { operations: BashOperations } | undefined {
	if (!runtimeState) return undefined
	return {
		operations: createContainerBashOps(
			runtimeState.containerName,
			runtimeState.mountSource,
			runtimeState.workdir,
		),
	}
}

export function sandboxSystemPromptSuffix(
	baseSystemPrompt: string,
): string | undefined {
	if (!runtimeState) return undefined
	const { containerName, workdir } = runtimeState
	return `${baseSystemPrompt}\n\n## Sandbox environment\nBash commands execute inside an Apple container VM ("${containerName}"), NOT on the macOS host:\n- Only the project directory is mounted, at ${workdir}. The current working directory is already inside it.\n- Host-only paths and tools do not exist in bash: /Applications, /Users, /opt/homebrew, brew, macOS apps. Never inspect or modify host system state via bash; use the read/edit/write tools for project files instead.\n- For macOS host administration (brew, osascript, system apps/services), use the \`host\` tool - never print commands for the user to paste.\n- HOME is the container user's home (e.g. /root), not the macOS home directory.\n- The container has its own localhost and network stack; servers you start are reachable from the host via the container IP.`
}

async function resolveDisabledReason(
	cwd: string,
	isDisabledByFlag: boolean,
): Promise<string | null> {
	if (isDisabledByFlag) return 'disabled via --no-container'
	const config: ContainerSandboxConfig = loadConfig(cwd)
	if (!config.enabled) return 'disabled via config'
	if (config.activation === 'off') return 'activation set to off in config'
	if (
		config.activation === 'marker' &&
		!existsSync(join(cwd, config.markerFile))
	) {
		return 'worktree not marked for containerization (run /container enable, then /reload)'
	}
	if (process.platform !== 'darwin') {
		return `unsupported platform ${process.platform}`
	}
	const available = await isContainerAvailable()
	if (!available)
		return '`container` CLI not found or system service down (install: github.com/apple/container releases, then `container system start`)'
	return null
}

async function ensureCreatedContainer(
	config: ContainerSandboxConfig,
	name: string,
	mountSource: string,
): Promise<string | null> {
	const created = await createContainer(name, {
		image: config.image,
		mountSource,
		workdir: config.workdir,
		cpus: config.cpus,
		memory: config.memory,
		env: config.env,
		runArgs: config.runArgs,
		initArgs: config.initArgs,
	})
	if (created.exitCode !== 0) {
		return `container run failed: ${created.stderr.trim() || created.stdout.trim() || 'unknown error'}`
	}
	return null
}

async function ensureContainer(
	config: ContainerSandboxConfig,
	name: string,
	mountSource: string,
): Promise<string | null> {
	try {
		const exists = await containerExists(name)
		if (!exists) return ensureCreatedContainer(config, name, mountSource)

		const running = await isContainerRunning(name)
		if (running) return null
		const started = await startExistingContainer(name)
		if (started.exitCode !== 0) {
			return `container start failed: ${started.stderr.trim() || 'unknown error'}`
		}
		return null
	} catch (err) {
		return containerUnavailableReason(err)
	}
}

/** Verify + provision the sandbox for this session and activate the runtime. */
export async function startSandboxSession(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
): Promise<void> {
	const disabledReason = await resolveDisabledReason(
		ctx.cwd,
		pi.getFlag('no-container') === true,
	)
	if (disabledReason) {
		ctx.ui.notify(`Container sandbox off: ${disabledReason}`, 'info')
		return
	}
	const config = loadConfig(ctx.cwd)
	const containerName = resolveContainerName(config, ctx.cwd)
	const mountSource = resolveMountSource(config, ctx.cwd) ?? ctx.cwd
	const failure = await ensureContainer(config, containerName, mountSource)
	if (failure) {
		ctx.ui.notify(`Container sandbox failed: ${failure}`, 'error')
		return
	}
	const bashTool = createBashTool(ctx.cwd, {
		operations: createContainerBashOps(
			containerName,
			mountSource,
			config.workdir,
		),
	})
	setRuntimeState(
		{ containerName, mountSource, workdir: config.workdir },
		bashTool,
	)

	const ip = bestEffortContainerIp(containerName)
	const status = `📦 container: ${containerName}${ip ? ` (${ip})` : ''}`
	ctx.ui.setStatus('container-sandbox', ctx.ui.theme.fg('accent', status))
	ctx.ui.notify(
		`Bash runs inside Apple container "${containerName}" - its own localhost, ports and network stack.`,
		'info',
	)
}

function showContainerStatus(ui: ExtensionContext['ui'], cwd: string): void {
	const config = loadConfig(cwd)
	const isMarked = existsSync(join(cwd, config.markerFile))
	const inactiveLine = `Container sandbox not active. Activation: ${config.activation}, marked: ${isMarked ? 'yes' : 'no'}.\n`
	if (!runtimeState) {
		ui.notify(
			`${inactiveLine}Enable with /container enable, then /reload.`,
			'info',
		)
		return
	}
	const ip = bestEffortContainerIp(runtimeState.containerName)
	const lines = [
		`Container: ${runtimeState.containerName}${ip ? `  (host access: http://${ip}:<port>)` : ''}`,
		`Image/mount: worktree mounted at ${runtimeState.workdir} (write-through)`,
		'Services inside the container use its own localhost - no port conflicts with other agents.',
		'Stop it with: /container stop',
	]
	ui.notify(lines.join('\n'), 'info')
}

async function handleStopCommand(ui: ExtensionContext['ui']): Promise<void> {
	if (!runtimeState) {
		ui.notify('No container sandbox running for this session.', 'info')
		return
	}
	await stopContainer(runtimeState.containerName)
	ui.notify(`Stopped ${runtimeState.containerName}.`, 'info')
}

/** `/container` subcommand dispatch: stop · enable · disable · status. */
export async function containerCommandHandler(
	args: string,
	ctx: ExtensionContext,
): Promise<void> {
	const subcommand = args.trim()
	if (subcommand === 'stop') {
		await handleStopCommand(ctx.ui)
		return
	}
	if (subcommand === 'enable') {
		markWorktree(ctx.cwd, true)
		ctx.ui.notify(
			'Marked this worktree for containerization. Run /reload to activate.',
			'info',
		)
		return
	}
	if (subcommand === 'disable') {
		markWorktree(ctx.cwd, false)
		ctx.ui.notify(
			'Worktree unmarked - run /reload to go back to native bash.',
			'info',
		)
		return
	}
	showContainerStatus(ctx.ui, ctx.cwd)
}
