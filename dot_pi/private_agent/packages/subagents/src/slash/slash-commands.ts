import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { keyText, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, type KeyId } from "@earendil-works/pi-tui";
import { discoverAgents, findBlockingAgentDiagnostic, formatUnknownAgentError, resolveAgentName, unknownAgentDiagnosticContext, type AgentConfig, type AgentDiscoveryDiagnostic, type AgentScope, type UnknownAgentDiagnosticContext } from "../agents/agents.ts";
import { resolveExistingReadPaths } from "../shared/settings.ts";
import type { SubagentParamsLike } from "../runs/foreground/subagent-executor.ts";
import type { SlashSubagentResponse, SlashSubagentUpdate } from "./slash-bridge.ts";
import { registerPromptWorkflowCommands } from "./prompt-workflows.ts";
import { collectSubagentCost, formatSubagentCostReport } from "./subagent-cost.ts";
import { openSubagentsAdmin } from "./subagents-admin.ts";
import { getInspectorPlugins } from "../inspectors/plugins.ts";
import {
	applySlashUpdate,
	buildSlashInitialResult,
	failSlashResult,
	finalizeSlashResult,
} from "./slash-live-state.ts";
import {
	SLASH_RESULT_TYPE,
	SLASH_TEXT_RESULT_TYPE,
	SLASH_SUBAGENT_CANCEL_EVENT,
	SLASH_SUBAGENT_REQUEST_EVENT,
	SLASH_SUBAGENT_RESPONSE_EVENT,
	SLASH_SUBAGENT_STARTED_EVENT,
	SLASH_SUBAGENT_UPDATE_EVENT,
	DIRS,
	type FleetKeybindingsConfig,
	type SingleResult,
	type SubagentState,
} from "../shared/types.ts";

interface InlineConfig {
	output?: string | false;
	outputMode?: "inline" | "file-only";
	reads?: string[] | false;
	model?: string;
	skill?: string[] | false;
}

const parseInlineConfig = (raw: string): InlineConfig => {
	const config: InlineConfig = {};
	for (const part of raw.split(",")) {
		const trimmed = part.trim();
		if (!trimmed) continue;
		const eq = trimmed.indexOf("=");
		if (eq === -1) continue;
		const key = trimmed.slice(0, eq).trim();
		const val = trimmed.slice(eq + 1).trim();
		switch (key) {
			case "output": config.output = val === "false" ? false : val; break;
			case "outputMode": if (val === "inline" || val === "file-only") config.outputMode = val; break;
			case "reads": config.reads = val === "false" ? false : val.split("+").filter(Boolean); break;
			case "model": config.model = val || undefined; break;
			case "skill": case "skills": config.skill = val === "false" ? false : val.split("+").filter(Boolean); break;
		}
	}
	return config;
};

const parseAgentToken = (token: string): { name: string; config: InlineConfig } => {
	const bracket = token.indexOf("[");
	if (bracket === -1) return { name: token, config: {} };
	const end = token.lastIndexOf("]");
	return { name: token.slice(0, bracket), config: parseInlineConfig(token.slice(bracket + 1, end !== -1 ? end : undefined)) };
};

const extractExecutionFlags = (rawArgs: string): { args: string; bg: boolean; fork: boolean } => {
	let args = rawArgs.trim();
	let bg = false;
	let fork = false;

	while (true) {
		if (args.endsWith(" --bg") || args === "--bg") {
			bg = true;
			args = args === "--bg" ? "" : args.slice(0, -5).trim();
			continue;
		}
		if (args.endsWith(" --fork") || args === "--fork") {
			fork = true;
			args = args === "--fork" ? "" : args.slice(0, -7).trim();
			continue;
		}
		break;
	}

	return { args, bg, fork };
};

function discoverSlashAgents(cwd: string, scope: AgentScope): { agents: AgentConfig[]; agentDiagnostics?: AgentDiscoveryDiagnostic[]; unknownAgentDiagnosticContext: UnknownAgentDiagnosticContext } {
	const discovered = discoverAgents(cwd, scope);
	return { ...discovered, unknownAgentDiagnosticContext: unknownAgentDiagnosticContext(discovered) };
}

const makeAgentCompletions = (state: SubagentState) => (prefix: string) => {
	if (!state.baseCwd || prefix.includes(" ")) return null;
	return discoverSlashAgents(state.baseCwd, "both").agents
		.filter((agent) => agent.name.startsWith(prefix))
		.map((agent) => ({ value: agent.name, label: agent.name }));
};

function sendSlashText(pi: ExtensionAPI, text: string): void {
	pi.sendMessage({ customType: SLASH_TEXT_RESULT_TYPE, content: text, display: true });
}

function selectForegroundDetachControl(state: SubagentState, requested: string) {
	const controls = [...state.foregroundControls.values()];
	if (requested) {
		const matches = controls.filter((control) => control.runId === requested || control.runId.startsWith(requested));
		if (matches.length > 1) throw new Error(`Ambiguous foreground run id prefix '${requested}' matched: ${matches.map((control) => control.runId).join(", ")}. Provide a longer id.`);
		return matches[0];
	}
	const singleControls = controls.filter((control) => control.mode === "single");
	if (state.lastForegroundControlId) {
		const latest = state.foregroundControls.get(state.lastForegroundControlId);
		if (latest?.mode === "single") return latest;
	}
	return singleControls.sort((left, right) => right.updatedAt - left.updatedAt)[0];
}

function isStaleExtensionContextError(error: unknown): boolean {
	return error instanceof Error
		&& (error.message.includes("This extension ctx is stale")
			|| error.message.includes("Extension context no longer active"));
}

function slashHasUI(ctx: ExtensionContext): boolean | undefined {
	try {
		return ctx.hasUI;
	} catch (error) {
		if (isStaleExtensionContextError(error)) return undefined;
		throw error;
	}
}


async function requestSlashRun(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	requestId: string,
	params: SubagentParamsLike,
	signal?: AbortSignal,
): Promise<SlashSubagentResponse> {
	return new Promise((resolve, reject) => {
		let done = false;
		let started = false;
		let startTimeout: ReturnType<typeof setTimeout> | undefined;

		const onStarted = (data: unknown) => {
			if (done || signal?.aborted || !data || typeof data !== "object") return;
			if ((data as { requestId?: unknown }).requestId !== requestId) return;
			started = true;
			if (startTimeout) clearTimeout(startTimeout);
			try {
				if (ctx.hasUI) ctx.ui.setStatus("subagent-slash", "running...");
			} catch (error) {
				if (isStaleExtensionContextError(error)) {
					finish(() => reject(error));
					return;
				}
				throw error;
			}
		};

		const onResponse = (data: unknown) => {
			if (done || signal?.aborted || !data || typeof data !== "object") return;
			const response = data as Partial<SlashSubagentResponse>;
			if (response.requestId !== requestId) return;
			if (startTimeout) clearTimeout(startTimeout);
			finish(() => resolve(response as SlashSubagentResponse));
		};

		const onUpdate = (data: unknown) => {
			if (done || signal?.aborted || !data || typeof data !== "object") return;
			const update = data as SlashSubagentUpdate;
			if (update.requestId !== requestId) return;
			applySlashUpdate(requestId, update);
			try {
				if (!ctx.hasUI) return;
				const tool = update.currentTool ? ` ${update.currentTool}` : "";
				const count = update.toolCount ?? 0;
				const liveDetailKey = keyText("app.tools.expand");
				ctx.ui.setStatus("subagent-slash", `${count} tools${tool} | ${liveDetailKey} live detail`);
			} catch (error) {
				if (isStaleExtensionContextError(error)) {
					finish(() => reject(error));
					return;
				}
				throw error;
			}
		};

		const onTerminalInput = ctx.hasUI
			? ctx.ui.onTerminalInput((input) => {
				if (!matchesKey(input, Key.escape)) return undefined;
				pi.events.emit(SLASH_SUBAGENT_CANCEL_EVENT, { requestId });
				finish(() => reject(new Error("Cancelled")));
				return { consume: true };
			})
			: undefined;

		const unsubStarted = pi.events.on(SLASH_SUBAGENT_STARTED_EVENT, onStarted);
		const unsubResponse = pi.events.on(SLASH_SUBAGENT_RESPONSE_EVENT, onResponse);
		const unsubUpdate = pi.events.on(SLASH_SUBAGENT_UPDATE_EVENT, onUpdate);

		let onAbort: () => void;
		const finish = (next: () => void) => {
			if (done) return;
			done = true;
			if (startTimeout) clearTimeout(startTimeout);
			unsubStarted();
			unsubResponse();
			unsubUpdate();
			try {
				onTerminalInput?.();
			} catch (error) {
				if (!isStaleExtensionContextError(error)) throw error;
			}
			signal?.removeEventListener("abort", onAbort);
			next();
		};
		onAbort = () => finish(() => reject(new Error("Slash subagent request canceled during session replacement or reload.")));
		startTimeout = setTimeout(() => {
			finish(() => reject(new Error(
				"Slash subagent bridge did not start within 15s. Ensure the extension is loaded correctly.",
			)));
		}, 15_000);

		if (signal?.aborted) {
			onAbort();
			return;
		}
		signal?.addEventListener("abort", onAbort, { once: true });
		try {
			pi.events.emit(SLASH_SUBAGENT_REQUEST_EVENT, { requestId, params, ctx });
		} catch (error) {
			if (isStaleExtensionContextError(error)) {
				finish(() => reject(error));
				return;
			}
			throw error;
		}

		// Bridge emits STARTED synchronously during REQUEST emit.
		// If not started, no bridge received the request.
		if (!started && done) return;
		if (!started) {
			finish(() => reject(new Error(
				"No slash subagent bridge responded. Ensure the subagent extension is loaded correctly.",
			)));
		}
	});
}

function extractSlashMessageText(content: string | Array<{ type?: string; text?: string }>): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => part?.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n");
}

function formatExportPathList(paths: string[]): string {
	return paths.map((file) => `- \`${file}\``).join("\n");
}

function collectResultPaths(results: SingleResult[], getPath: (result: SingleResult) => string | undefined): string[] {
	return results
		.map(getPath)
		.filter((file): file is string => typeof file === "string" && file.length > 0);
}

function buildSlashExportText(response: SlashSubagentResponse): string {
	const output = extractSlashMessageText(response.result.content) || response.errorText || "(no output)";
	const results = response.result.details?.results ?? [];
	const sessionFiles = collectResultPaths(results, (result) => result.sessionFile);
	const savedOutputs = collectResultPaths(results, (result) => result.savedOutputPath);
	const artifactOutputs = collectResultPaths(results, (result) => result.artifactPaths?.outputPath);
	const sections = ["## Subagent result", output];
	if (sessionFiles.length > 0) sections.push("## Child session exports", formatExportPathList(sessionFiles));
	if (savedOutputs.length > 0) sections.push("## Saved outputs", formatExportPathList(savedOutputs));
	if (artifactOutputs.length > 0) sections.push("## Artifact outputs", formatExportPathList(artifactOutputs));
	return sections.join("\n\n");
}

function persistSlashSessionSnapshot(ctx: ExtensionContext): void {
	try {
		if (!ctx.sessionManager) return;
		const sessionManager = ctx.sessionManager as typeof ctx.sessionManager & {
			_rewriteFile?: () => void;
			flushed?: boolean;
		};
		const sessionFile = sessionManager.getSessionFile();
		if (!sessionFile || typeof sessionManager._rewriteFile !== "function") return;
		fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
		sessionManager._rewriteFile();
		sessionManager.flushed = true;
	} catch (error) {
		console.error("Failed to persist slash session snapshot for export:", error);
	}
}

async function runSlashSubagent(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	params: SubagentParamsLike,
	signal?: AbortSignal,
): Promise<void> {
	if (signal?.aborted) return;
	const initialHasUI = slashHasUI(ctx);
	if (initialHasUI === undefined) return;
	try {
		if (initialHasUI) ctx.ui.setToolsExpanded(false);
	} catch (error) {
		if (isStaleExtensionContextError(error)) return;
		throw error;
	}
	const requestId = randomUUID();
	const initialDetails = buildSlashInitialResult(requestId, params);
	const initialText = extractSlashMessageText(initialDetails.result.content) || "Running subagent...";
	try {
		pi.sendMessage({
			customType: SLASH_RESULT_TYPE,
			content: initialText,
			display: true,
			details: initialDetails,
		});
	} catch (error) {
		if (isStaleExtensionContextError(error)) return;
		throw error;
	}
	persistSlashSessionSnapshot(ctx);

	try {
		const response = await requestSlashRun(pi, ctx, requestId, params, signal);
		if (signal?.aborted) return;
		const hasUI = slashHasUI(ctx);
		if (hasUI === undefined) return;
		const finalDetails = finalizeSlashResult(response);
		pi.sendMessage({
			customType: SLASH_RESULT_TYPE,
			content: buildSlashExportText(response),
			display: !hasUI,
			details: finalDetails,
		});
		persistSlashSessionSnapshot(ctx);
		if (hasUI) {
			ctx.ui.setStatus("subagent-slash", undefined);
		}
		if (response.isError && hasUI) {
			ctx.ui.notify(response.errorText || "Subagent failed", "error");
		}
	} catch (error) {
		if (signal?.aborted || isStaleExtensionContextError(error)) return;
		const message = error instanceof Error ? error.message : String(error);
		const hasUI = slashHasUI(ctx);
		if (hasUI === undefined) return;
		const failedDetails = failSlashResult(requestId, params, message);
		pi.sendMessage({
			customType: SLASH_RESULT_TYPE,
			content: `## Subagent result\n\n${message}`,
			display: !hasUI,
			details: failedDetails,
		});
		persistSlashSessionSnapshot(ctx);
		if (hasUI) {
			ctx.ui.setStatus("subagent-slash", undefined);
		}
		if (message === "Cancelled") {
			if (hasUI) ctx.ui.notify("Cancelled", "warning");
			return;
		}
		if (hasUI) ctx.ui.notify(message, "error");
	}
}

function slashRunWorkflowScript(key: string, child: SubagentParamsLike): string {
	return `return runs.run(${JSON.stringify(key)}, ${JSON.stringify(child)})`;
}

export function registerSlashCommands(
	pi: ExtensionAPI,
	state: SubagentState,
	options: { fleetKeybindings?: FleetKeybindingsConfig; foregroundDetachShortcut?: string } = {},
): { dispose: () => void } {
	let fleetOpen = false;
	let disposed = false;
	const pendingRequests = new Set<AbortController>();
	const runCommand = (ctx: ExtensionContext, params: SubagentParamsLike): Promise<void> => {
		if (disposed) return Promise.resolve();
		const controller = new AbortController();
		pendingRequests.add(controller);
		return runSlashSubagent(pi, ctx, params, controller.signal).finally(() => pendingRequests.delete(controller));
	};
	const launchCommand = (ctx: ExtensionContext, params: SubagentParamsLike): void => {
		void runCommand(ctx, params);
	};
	const showFleet = async (ctx: ExtensionContext) => {
		state.lastUiContext = ctx;
		if (!ctx.hasUI) {
			await runCommand(ctx, { action: "status", view: "fleet" });
			return;
		}
		if (fleetOpen) {
			ctx.ui.notify("Subagent fleet inspector is already open.", "info");
			return;
		}
		fleetOpen = true;
		try {
			const { openSubagentFleet } = await import("../tui/fleet.ts");
			await openSubagentFleet(ctx, state, { asyncDirRoot: DIRS.async, inspectorPlugins: getInspectorPlugins, resultsDir: DIRS.results, fleetKeybindings: options.fleetKeybindings });
		} finally {
			fleetOpen = false;
		}
	};

	pi.registerCommand("subagents", {
		description: "Administer subagents: inspect metadata and update models, thinking, or prompts",
		handler: async (args, ctx) => {
			await openSubagentsAdmin(pi, ctx, args);
		},
	});

	pi.registerCommand("run", {
		description: "Run one subagent through a workflow script: /run agent[output=file] [task] [--bg] [--fork]",
		getArgumentCompletions: makeAgentCompletions(state),
		handler: async (args, ctx) => {
			const { args: cleanedArgs, bg, fork } = extractExecutionFlags(args);
			const input = cleanedArgs.trim();
			const firstSpace = input.indexOf(" ");
			if (!input) { ctx.ui.notify("Usage: /run <agent> [task] [--bg] [--fork]", "error"); return; }
			const { name: agentName, config: inline } = parseAgentToken(firstSpace === -1 ? input : input.slice(0, firstSpace));
			const task = firstSpace === -1 ? "" : input.slice(firstSpace + 1).trim();

			if (!state.baseCwd) { ctx.ui.notify("Subagent session cwd is not initialized yet", "error"); return; }
			const discovered = discoverSlashAgents(state.baseCwd, "both");
			const resolvedAgent = resolveAgentName(agentName, discovered.agents);
			const candidates = resolvedAgent.error
				? discovered.agents.filter((agent) => resolveAgentName(agentName, [agent]).agent)
				: resolvedAgent.agent;
			const diagnostic = findBlockingAgentDiagnostic(agentName, candidates, discovered.agentDiagnostics);
			if (diagnostic || resolvedAgent.error || !resolvedAgent.agent) {
				ctx.ui.notify(diagnostic ? `Agent '${agentName}' has invalid configuration: ${diagnostic.error}` : resolvedAgent.error ?? formatUnknownAgentError(agentName, discovered.unknownAgentDiagnosticContext), "error");
				return;
			}

			let finalTask = task;
			if (inline.reads && Array.isArray(inline.reads) && inline.reads.length > 0) {
				const existingReads = inline.reads.filter((read) => resolveExistingReadPaths([read], state.baseCwd).length > 0);
				if (existingReads.length > 0) finalTask = `[Read from: ${existingReads.join(", ")}]\n\n${finalTask}`;
			}
			const child: SubagentParamsLike = { agent: agentName, task: finalTask, agentScope: "both" };
			if (inline.output !== undefined) child.output = inline.output;
			if (inline.outputMode !== undefined) child.outputMode = inline.outputMode;
			if (inline.skill !== undefined) child.skill = inline.skill;
			if (inline.model) child.model = inline.model;
			if (fork) child.context = "fork";
			launchCommand(ctx, { workflowScript: slashRunWorkflowScript("run", child), async: bg });
		},
	});

	pi.registerCommand("subagent-cost", {
		description: "Show parent and subagent child usage cost for this session",
		handler: async (_args, ctx) => {
			sendSlashText(pi, formatSubagentCostReport(collectSubagentCost(ctx, state)));
		},
	});

	pi.registerCommand("subagents-fleet", {
		description: "Open the live subagent fleet inspector",
		handler: async (_args, ctx) => showFleet(ctx),
	});

	const detachForegroundRun = (args: string, ctx: ExtensionContext): void => {
		const id = args.trim();
		let control: ReturnType<typeof selectForegroundDetachControl>;
		try {
			control = selectForegroundDetachControl(state, id);
		} catch (error) {
			ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			return;
		}
		if (!control) {
			ctx.ui.notify(id ? `No active foreground run found for '${id}'.` : "No active foreground single-subagent run to detach.", "info");
			return;
		}
		if (control.mode !== "single") {
			ctx.ui.notify("/subagents-detach currently supports single-subagent runs only.", "error");
			return;
		}
		if (!control.detach?.()) {
			ctx.ui.notify(`Foreground run ${control.runId} is not currently detachable.`, "info");
			return;
		}
		sendSlashText(pi, `Detached foreground run ${control.runId} without terminating its child. Use subagent({ action: "status", id: ${JSON.stringify(control.runId)} }) or bg_wait({ id: ${JSON.stringify(control.runId)} }) to recover the eventual result. This does not daemonize the process or guarantee survival across Pi reload/restart.`);
	};

	pi.registerCommand("subagents-detach", {
		description: "Detach the active foreground single-subagent run without terminating it",
		handler: async (args, ctx) => detachForegroundRun(args, ctx),
	});

	if (options.foregroundDetachShortcut) {
		pi.registerShortcut(options.foregroundDetachShortcut as KeyId, {
			description: "Detach the active foreground subagent and keep it running in the background",
			handler: async (ctx) => detachForegroundRun("", ctx),
		});
	}

	registerPromptWorkflowCommands({
		pi,
		run: async (params, ctx) => {
			launchCommand(ctx, params);
		},
	});

	return {
		dispose: () => {
			if (disposed) return;
			disposed = true;
			// A reload revokes the command context; do not let delayed responses
			// resume a command against the old Pi context.
			for (const controller of pendingRequests) controller.abort();
			pendingRequests.clear();
		},
	};
}
