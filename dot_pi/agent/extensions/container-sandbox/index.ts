import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBashTool } from "@earendil-works/pi-coding-agent";
import {
	bestEffortContainerIp,
	containerExists,
	containerUnavailableReason,
	createContainer,
	isContainerAvailable,
	isContainerRunning,
	startExistingContainer,
	stopContainer,
} from "./container";
import { loadConfig, resolveContainerName, resolveMountSource, type ContainerSandboxConfig } from "./config";
import { createContainerBashOps } from "./bash-ops";

interface RuntimeState {
	containerName: string;
	mountSource: string;
	workdir: string;
}

export default function (pi: ExtensionAPI) {
	pi.registerFlag("no-container", {
		description: "Disable routing bash into the Apple container sandbox",
		type: "boolean",
		default: false,
	});

	const localCwd = process.cwd();
	const localBash = createBashTool(localCwd);

	let runtime: RuntimeState | null = null;
	let sandboxedBash: ReturnType<typeof createBashTool> | null = null;

	// Escape hatch: bash on the macOS host for administration the container cannot do.
	pi.registerTool({
		...localBash,
		name: "host",
		label: "bash (macOS host)",
		description:
			"Run a command on the macOS HOST, outside the container sandbox. Use ONLY for host administration that cannot run inside the container: brew, osascript, launchctl, /Applications apps, macOS system settings, host networking. NEVER use it for project work (build, test, lint, dependency install, dev servers, file inspection) — the bash tool already covers the mounted project inside the container.",
		async execute(id, params, signal, onUpdate, _ctx) {
			return localBash.execute(id, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		...localBash,
		label: "bash (container)",
		async execute(id, params, signal, onUpdate, _ctx) {
			if (!runtime || !sandboxedBash) {
				return localBash.execute(id, params, signal, onUpdate);
			}
			return sandboxedBash.execute(id, params, signal, onUpdate);
		},
	});

	pi.on("user_bash", () => {
		if (!runtime) return;
		return { operations: createContainerBashOps(runtime.containerName, runtime.mountSource, runtime.workdir) };
	});

	// Tell the model it is inside a container, every turn, only while the sandbox is active.
	pi.on("before_agent_start", (event) => {
		if (!runtime) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n## Sandbox environment\nBash commands execute inside an Apple container VM ("${runtime.containerName}"), NOT on the macOS host:\n- Only the project directory is mounted, at ${runtime.workdir}. The current working directory is already inside it.\n- Host-only paths and tools do not exist in bash: /Applications, /Users, /opt/homebrew, brew, macOS apps. Never inspect or modify host system state via bash; use the read/edit/write tools for project files instead.
- For macOS host administration (brew, osascript, system apps/services), use the \`host\` tool — never print commands for the user to paste.\n- HOME is the container user's home (e.g. /root), not the macOS home directory.\n- The container has its own localhost and network stack; servers you start are reachable from the host via the container IP.`,
		};
	});

	pi.on("session_start", async (_event, ctx) => {
		const disabledReason = await resolveDisabledReason(ctx.cwd, pi.getFlag("no-container") as boolean);
		if (disabledReason) {
			ctx.ui.notify(`Container sandbox off: ${disabledReason}`, "info");
			return;
		}

		const config = loadConfig(ctx.cwd);
		const containerName = resolveContainerName(config, ctx.cwd);
		const mountSource = resolveMountSource(config, ctx.cwd) ?? ctx.cwd;

		const failure = await ensureContainer(config, containerName, mountSource);
		if (failure) {
			ctx.ui.notify(`Container sandbox failed: ${failure}`, "error");
			return;
		}

		runtime = { containerName, mountSource, workdir: config.workdir };
		sandboxedBash = createBashTool(ctx.cwd, {
			operations: createContainerBashOps(containerName, mountSource, config.workdir),
		});

		const ip = bestEffortContainerIp(containerName);
		const status = `📦 container: ${containerName}${ip ? ` (${ip})` : ""}`;
		ctx.ui.setStatus("container-sandbox", ctx.ui.theme.fg("accent", status));
		ctx.ui.notify(
			`Bash runs inside Apple container "${containerName}" — its own localhost, ports and network stack.`,
			"info",
		);
	});

	pi.registerCommand("container", {
		description: "Show Apple container sandbox status (or: /container stop)",
		handler: async (args, ctx) => {
			if (args.trim() === "stop") {
				await handleStopCommand(ctx.cwd, ctx.ui);
				return;
			}
			showStatus(ctx.ui);
		},
	});

	function showStatus(ui: ExtensionAPI["ui"]): void {
		if (!runtime) {
			ui.notify("Container sandbox is not active in this session.", "info");
			return;
		}
		const ip = bestEffortContainerIp(runtime.containerName);
		const lines = [
			`Container: ${runtime.containerName}${ip ? `  (host access: http://${ip}:<port>)` : ""}`,
			`Image/mount: worktree mounted at ${runtime.workdir} (write-through)`,
			"Services inside the container use its own localhost — no port conflicts with other agents.",
			"Stop it with: /container stop",
		];
		ui.notify(lines.join("\n"), "info");
	}

	async function handleStopCommand(ui: ExtensionAPI["ui"]): Promise<void> {
		if (!runtime) {
			ui.notify("No container sandbox running for this session.", "info");
			return;
		}
		await stopContainer(runtime.containerName);
		ui.notify(`Stopped ${runtime.containerName}.`, "info");
	}

	pi.on("session_shutdown", async () => {
		// Intentionally keep the container running: sessions resume and dev servers survive.
		// Use /container stop for explicit teardown.
		runtime = null;
	});
}

async function resolveDisabledReason(cwd: string, flagDisabled: boolean): Promise<string | null> {
	if (flagDisabled) return "disabled via --no-container";
	const config: ContainerSandboxConfig = loadConfig(cwd);
	if (!config.enabled) return "disabled via config";
	if (process.platform !== "darwin") return `unsupported platform ${process.platform}`;
	const available = await isContainerAvailable();
	if (!available) return "`container` CLI not found or system service down (install: github.com/apple/container releases, then `container system start`)";
	return null;
}

async function ensureContainer(config: ContainerSandboxConfig, name: string, mountSource: string): Promise<string | null> {
	try {
		const exists = await containerExists(name);
		if (!exists) {
			const created = await createContainer(name, {
				image: config.image,
				mountSource,
				workdir: config.workdir,
				cpus: config.cpus,
				memory: config.memory,
				env: config.env,
				runArgs: config.runArgs,
				initArgs: config.initArgs,
			});
			if (created.exitCode !== 0) {
				return `container run failed: ${created.stderr.trim() || created.stdout.trim() || "unknown error"}`;
			}
			return null;
		}

		const running = await isContainerRunning(name);
		if (running) return null;
		const started = await startExistingContainer(name);
		if (started.exitCode !== 0) {
			return `container start failed: ${started.stderr.trim() || "unknown error"}`;
		}
		return null;
	} catch (err) {
		return containerUnavailableReason(err);
	}
}