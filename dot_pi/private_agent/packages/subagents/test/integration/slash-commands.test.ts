import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { beforeEach, describe, it } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { updateActiveRunIndex } from "../../src/runs/background/active-run-index.ts";
import { getArtifactPaths, getArtifactsDir } from "../../src/shared/artifacts.ts";
import { ASYNC_DIR, DIRS } from "../../src/shared/types.ts";

const SLASH_RESULT_TYPE = "subagent-slash-result";
const SLASH_SUBAGENT_REQUEST_EVENT = "subagent:slash:request";
const SLASH_SUBAGENT_STARTED_EVENT = "subagent:slash:started";
const SLASH_SUBAGENT_RESPONSE_EVENT = "subagent:slash:response";

interface EventBus {
	on(event: string, handler: (data: unknown) => void): () => void;
	emit(event: string, data: unknown): void;
}

type RegisteredSlashCommand = { handler(args: string, ctx: unknown): Promise<void>; getArgumentCompletions?: (prefix: string) => unknown };

interface RegisterSlashCommandsModule {
	registerSlashCommands?: (
		pi: {
			events: EventBus;
			registerCommand(
				name: string,
				spec: RegisteredSlashCommand,
			): void;
			registerShortcut(key: string, spec: { handler(ctx: unknown): Promise<void> }): void;
			sendMessage(message: unknown): void;
			setModel?(model: unknown): Promise<boolean>;
		},
		state: {
			baseCwd: string;
			currentSessionId: string | null;
			asyncJobs: Map<string, unknown>;
			cleanupTimers: Map<string, ReturnType<typeof setTimeout>>;
			lastUiContext: unknown;
			poller: NodeJS.Timeout | null;
			completionSeen: Map<string, number>;
			watcher: unknown;
			watcherRestartTimer: ReturnType<typeof setTimeout> | null;
			resultFileCoalescer: { schedule(file: string, delayMs?: number): boolean; clear(): void };
		},
		options?: { foregroundDetachShortcut?: string },
	) => { dispose(): void };
}

interface SlashLiveStateModule {
	clearSlashSnapshots?: typeof import("../../src/slash/slash-live-state.ts").clearSlashSnapshots;
	getSlashRenderableSnapshot?: typeof import("../../src/slash/slash-live-state.ts").getSlashRenderableSnapshot;
	resolveSlashMessageDetails?: typeof import("../../src/slash/slash-live-state.ts").resolveSlashMessageDetails;
}

let registerSlashCommands: RegisterSlashCommandsModule["registerSlashCommands"];
let clearSlashSnapshots: SlashLiveStateModule["clearSlashSnapshots"];
let getSlashRenderableSnapshot: SlashLiveStateModule["getSlashRenderableSnapshot"];
let resolveSlashMessageDetails: SlashLiveStateModule["resolveSlashMessageDetails"];
let available = true;
try {
	({ registerSlashCommands } = await import("../../src/slash/slash-commands.ts") as RegisterSlashCommandsModule);
	({ clearSlashSnapshots, getSlashRenderableSnapshot, resolveSlashMessageDetails } = await import("../../src/slash/slash-live-state.ts") as SlashLiveStateModule);
} catch {
	available = false;
}

function createEventBus(): EventBus {
	const handlers = new Map<string, Array<(data: unknown) => void>>();
	return {
		on(event, handler) {
			const existing = handlers.get(event) ?? [];
			existing.push(handler);
			handlers.set(event, existing);
			return () => {
				const current = handlers.get(event) ?? [];
				handlers.set(event, current.filter((entry) => entry !== handler));
			};
		},
		emit(event, data) {
			for (const handler of handlers.get(event) ?? []) {
				handler(data);
			}
		},
	};
}

function createState(cwd: string) {
	return {
		baseCwd: cwd,
		currentSessionId: null,
		asyncJobs: new Map(),
		foregroundRuns: new Map(),
		foregroundControls: new Map(),
		lastForegroundControlId: null,
		cleanupTimers: new Map(),
		lastUiContext: null,
		poller: null,
		completionSeen: new Map(),
		watcher: null,
		watcherRestartTimer: null,
		resultFileCoalescer: {
			schedule: () => false,
			clear: () => {},
		},
	};
}

async function withIsolatedHome<T>(fn: () => Promise<T>): Promise<T> {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-slash-home-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	process.env.PI_CODING_AGENT_DIR = path.join(home, ".pi", "agent");
	process.env.HOME = home;
	process.env.USERPROFILE = home;
	try {
		return await fn();
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		if (previousUserProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = previousUserProfile;
		fs.rmSync(home, { recursive: true, force: true });
	}
}


function createCommandContext(
	overrides: Partial<{
		cwd: string;
		hasUI: boolean;
		custom: (...args: unknown[]) => Promise<unknown>;
		notify: (message: string, type?: string) => void;
		confirm: (title: string, message: string) => Promise<boolean>;
		select: (title: string, choices: string[]) => Promise<string | undefined>;
		editor: (title: string, prefill: string) => Promise<string | undefined>;
		setStatus: (key: string, text: string | undefined) => void;
		setToolsExpanded: (expanded: boolean) => void;
		sessionManager: unknown;
		modelRegistry: {
			refresh?: () => void;
			getAvailable: () => Array<{ provider: string; id: string; reasoning?: boolean; thinkingLevelMap?: Record<string, string | null> }>;
			find?: (provider: string, id: string) => unknown;
			hasConfiguredAuth?: (model: unknown) => boolean;
		};
		model: { provider: string; id: string };
		thinkingLevel: string;
	}> = {},
) {
	return {
		cwd: overrides.cwd ?? process.cwd(),
		hasUI: overrides.hasUI ?? false,
		ui: {
			notify: overrides.notify ?? ((_message: string) => {}),
			confirm: overrides.confirm ?? (async () => false),
			select: overrides.select ?? (async () => undefined),
			editor: overrides.editor ?? (async () => undefined),
			setStatus: overrides.setStatus ?? ((_key: string, _text: string | undefined) => {}),
			setToolsExpanded: overrides.setToolsExpanded ?? ((_expanded: boolean) => {}),
			onTerminalInput: () => () => {},
			...(overrides.custom ? { custom: overrides.custom } : {}),
		},
		model: overrides.model,
		thinkingLevel: overrides.thinkingLevel,
		modelRegistry: overrides.modelRegistry ?? { getAvailable: () => [], find: () => undefined, hasConfiguredAuth: () => true },
		sessionManager: overrides.sessionManager ?? {
			getSessionFile: () => null,
			getSessionId: () => "session-test",
		},
	};
}

async function withTempProject<T>(prefix: string, fn: (root: string) => Promise<T>): Promise<T> {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	fs.mkdirSync(path.join(root, ".pi", "agents"), { recursive: true });
	fs.mkdirSync(path.join(root, ".pi", "chains"), { recursive: true });
	try {
		return await fn(root);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
}

function writeProjectChain(root: string, fileName: string, content: string): void {
	fs.writeFileSync(path.join(root, ".pi", "chains", fileName), content, "utf-8");
}

async function captureSlashCommandParams(
	commandName: string,
	args: string,
	cwd: string,
): Promise<{ params: unknown; notifications: string[] }> {
	return withIsolatedHome(async () => {
		const commands = new Map<string, RegisteredSlashCommand>();
		const events = createEventBus();
		let requestedParams: unknown;
		const notifications: string[] = [];
		events.on(SLASH_SUBAGENT_REQUEST_EVENT, (data) => {
			const payload = data as { requestId: string; params?: unknown };
			requestedParams = payload.params;
			events.emit(SLASH_SUBAGENT_STARTED_EVENT, { requestId: payload.requestId });
			events.emit(SLASH_SUBAGENT_RESPONSE_EVENT, {
				requestId: payload.requestId,
				result: {
					content: [{ type: "text", text: `${commandName} finished` }],
					details: { mode: "chain", results: [] },
				},
				isError: false,
			});
		});

		const pi = {
			events,
			on() { return () => {}; },
			registerTool() {},
			registerCommand(name: string, spec: RegisteredSlashCommand) {
				commands.set(name, spec);
			},
			registerShortcut() {},
			sendMessage(_message: unknown) {},
		};

		registerSlashCommands!(pi, createState(cwd));
		await commands.get(commandName)!.handler(args, createCommandContext({
			cwd,
			notify: (message) => {
				notifications.push(message);
			},
		}));
		return { params: requestedParams, notifications };
	});
}

describe("slash command custom message delivery", { skip: !available ? "slash-commands.ts not importable" : undefined }, () => {
	beforeEach(() => {
		clearSlashSnapshots?.();
	});

	it("/subagent-cost recovers async workflow usage from receipts and metadata", async () => {
		await withTempProject("pi-subagent-cost-async-", async (root) => {
			const workflowRunId = `workflow-cost-${process.pid}-${Date.now()}`;
			const earlierChildRunId = `child-cost-earlier-${process.pid}-${Date.now()}`;
			const childRunId = `child-cost-${process.pid}-${Date.now()}`;
			const asyncDir = path.join(DIRS.async, workflowRunId);
			const sessionFile = path.join(root, "sessions", "parent.jsonl");
			const artifactsDir = getArtifactsDir(sessionFile, root, "session");
			const earlierMetadataPath = getArtifactPaths(artifactsDir, earlierChildRunId, "reviewer", 0).metadataPath;
			const metadataPath = getArtifactPaths(artifactsDir, childRunId, "reviewer", 0).metadataPath;
			fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
			fs.writeFileSync(sessionFile, "", "utf-8");
			fs.mkdirSync(asyncDir, { recursive: true });
			fs.mkdirSync(path.dirname(earlierMetadataPath), { recursive: true });
			fs.writeFileSync(path.join(asyncDir, "workflow-receipt.json"), JSON.stringify({
				version: 1,
				workflowRunId,
				state: "complete",
				createdAt: Date.now(),
				entries: {
					review: {
						key: "review",
						agent: "reviewer",
						latestRunId: childRunId,
						continuation: { runIds: [earlierChildRunId, childRunId] },
						resumability: { state: "resumable" },
					},
				},
				workflowChildren: {
					version: 1,
					parentToolCallId: "tool-1",
					workflowRunId,
					inventoryComplete: true,
					workflowState: "completed",
					children: [{ childId: "review", state: "completed", runId: childRunId, agent: "reviewer" }],
				},
			}, null, 2), "utf-8");
			fs.writeFileSync(earlierMetadataPath, JSON.stringify({
				runId: earlierChildRunId,
				agent: "reviewer",
				usage: { input: 8, output: 3, cacheRead: 5, cacheWrite: 0, cost: 0.25, turns: 1 },
			}, null, 2), "utf-8");
			fs.writeFileSync(metadataPath, JSON.stringify({
				runId: childRunId,
				agent: "reviewer",
				usage: { input: 20, output: 4, cacheRead: 80, cacheWrite: 0, cost: 0.5, turns: 2 },
			}, null, 2), "utf-8");

			const sent: unknown[] = [];
			const commands = new Map<string, RegisteredSlashCommand>();
			const pi = {
				events: createEventBus(),
				registerCommand(name: string, spec: RegisteredSlashCommand) { commands.set(name, spec); },
				registerShortcut() {},
				sendMessage(message: unknown) { sent.push(message); },
			};
			const branch = [
				{ type: "message", message: { role: "assistant", usage: { input: 10, output: 2, cacheRead: 30, cacheWrite: 0, cost: { total: 0.2 } } } },
				{ type: "compaction", usage: { input: 5, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total: 0.05 } } },
				{ type: "message", message: { role: "toolResult", toolName: "subagent", details: { mode: "workflow", runId: workflowRunId, asyncId: workflowRunId, results: [] } } },
			];
			try {
				registerSlashCommands!(pi as never, createState(root));
				await commands.get("subagent-cost")!.handler("", createCommandContext({
					cwd: root,
					sessionManager: {
						getBranch: () => branch,
						getSessionFile: () => sessionFile,
						getSessionId: () => "session-parent",
					},
				}));
				const report = String((sent[0] as { content?: unknown }).content ?? "");
				assert.match(report, /Parent: ↑15 ↓3 \$0\.2500/);
				assert.match(report, /Child 1 \(reviewer\): ↑8 ↓3 \$0\.2500 \(cache read 5, 1 turn\)/);
				assert.match(report, /Child 2 \(reviewer\): ↑20 ↓4 \$0\.5000 \(cache read 80, 2 turns\)/);
				assert.equal((report.match(/Child \d+ \(reviewer\):/g) ?? []).length, 2);
				assert.match(report, /Children: ↑28 ↓7 \$0\.7500 \(cache read 85, 3 turns\)/);
				assert.match(report, /Total: ↑43 ↓10 \$1\.0000 \(cache read 115, 4 turns\)/);
				assert.doesNotMatch(report, /No subagent child usage/);
			} finally {
				fs.rmSync(asyncDir, { recursive: true, force: true });
			}
		});
	});

	it("/subagent-cost recovers async single and chain usage from status steps and metadata", async () => {
		await withTempProject("pi-subagent-cost-async-single-", async (root) => {
			const singleRunId = `single-cost-${process.pid}-${Date.now()}`;
			const chainRunId = `chain-cost-${process.pid}-${Date.now()}`;
			const sessionFile = path.join(root, "sessions", "parent.jsonl");
			const artifactsDir = getArtifactsDir(sessionFile, root, "session");
			fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
			fs.writeFileSync(sessionFile, "", "utf-8");
			fs.mkdirSync(artifactsDir, { recursive: true });
			const runningRunId = `running-cost-${process.pid}-${Date.now()}`;
			const writeRun = (runId: string, agents: string[], stepStatus = "complete") => {
				fs.mkdirSync(path.join(DIRS.async, runId), { recursive: true });
				fs.writeFileSync(path.join(DIRS.async, runId, "status.json"), JSON.stringify({
					runId, mode: agents.length > 1 ? "chain" : "single", state: stepStatus === "complete" ? "complete" : "running", startedAt: Date.now(), cwd: root,
					steps: agents.map((agent) => ({ agent, status: stepStatus })),
				}), "utf-8");
			};
			const writeMetadata = (runId: string, agent: string, index: number | undefined, usage: Record<string, number>) => {
				fs.writeFileSync(getArtifactPaths(artifactsDir, runId, agent, index).metadataPath, JSON.stringify({ runId, agent, usage }), "utf-8");
			};
			writeRun(singleRunId, ["oracle"]);
			writeMetadata(singleRunId, "oracle", undefined, { input: 30, output: 6, cacheRead: 0, cacheWrite: 0, cost: 0.3, turns: 2 });
			writeRun(chainRunId, ["scout", "worker"]);
			writeMetadata(chainRunId, "scout", 0, { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0.1, turns: 1 });
			writeMetadata(chainRunId, "worker", 1, { input: 40, output: 8, cacheRead: 0, cacheWrite: 0, cost: 0.4, turns: 3 });
			// A still-running child has no metadata yet and is not "unavailable".
			writeRun(runningRunId, ["reviewer"], "running");

			const sent: unknown[] = [];
			const commands = new Map<string, RegisteredSlashCommand>();
			const pi = {
				events: createEventBus(),
				registerCommand(name: string, spec: RegisteredSlashCommand) { commands.set(name, spec); },
				registerShortcut() {},
				sendMessage(message: unknown) { sent.push(message); },
			};
			const branch = [
				{ type: "message", message: { role: "toolResult", toolName: "subagent", details: { mode: "single", runId: singleRunId, asyncId: singleRunId, results: [] } } },
				{ type: "message", message: { role: "toolResult", toolName: "subagent", details: { mode: "chain", runId: chainRunId, asyncId: chainRunId, results: [] } } },
				{ type: "message", message: { role: "toolResult", toolName: "subagent", details: { mode: "single", runId: runningRunId, asyncId: runningRunId, results: [] } } },
				// The chain's bg_wait completion must not be counted again from artifacts.
				{ type: "message", message: { role: "toolResult", toolName: "bg_wait", details: { mode: "single", results: [], completions: [{ runId: chainRunId, mode: "chain", results: [
					{ agent: "scout", usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0.1, turns: 1 } },
					{ agent: "worker", usage: { input: 40, output: 8, cacheRead: 0, cacheWrite: 0, cost: 0.4, turns: 3 } },
				] }] } } },
			];
			try {
				registerSlashCommands!(pi as never, createState(root));
				await commands.get("subagent-cost")!.handler("", createCommandContext({
					cwd: root,
					sessionManager: {
						getBranch: () => branch,
						getSessionFile: () => sessionFile,
						getSessionId: () => "session-parent",
					},
				}));
				const report = String((sent[0] as { content?: unknown }).content ?? "");
				assert.match(report, /Child \d \(oracle\): ↑30 ↓6 \$0\.3000 \(2 turns\)/);
				assert.match(report, /Child \d \(scout\): ↑10 ↓2 \$0\.1000 \(1 turn\)/);
				assert.match(report, /Child \d \(worker\): ↑40 ↓8 \$0\.4000 \(3 turns\)/);
				assert.equal((report.match(/Child \d+ \(/g) ?? []).length, 3);
				assert.match(report, /Children: ↑80 ↓16 \$0\.8000 \(6 turns\)/);
				assert.doesNotMatch(report, /Async child usage unavailable/);
			} finally {
				fs.rmSync(path.join(DIRS.async, singleRunId), { recursive: true, force: true });
				fs.rmSync(path.join(DIRS.async, chainRunId), { recursive: true, force: true });
				fs.rmSync(path.join(DIRS.async, runningRunId), { recursive: true, force: true });
			}
		});
	});

	it("registers a configured foreground detach shortcut", async () => {
		const shortcuts = new Map<string, { handler(ctx: unknown): Promise<void> }>();
		const sent: unknown[] = [];
		const state = createState(process.cwd());
		let detachCalls = 0;
		state.foregroundControls.set("run-123", {
			runId: "run-123",
			mode: "single",
			updatedAt: Date.now(),
			detach: () => {
				detachCalls += 1;
				return true;
			},
		});
		state.lastForegroundControlId = "run-123";

		registerSlashCommands!({
			events: createEventBus(),
			registerCommand() {},
			registerShortcut(key: string, spec: { handler(ctx: unknown): Promise<void> }) {
				shortcuts.set(key, spec);
			},
			sendMessage(message: unknown) { sent.push(message); },
		}, state, { foregroundDetachShortcut: "ctrl+b" });

		assert.ok(shortcuts.has("ctrl+b"));
		await shortcuts.get("ctrl+b")!.handler(createCommandContext());
		assert.equal(detachCalls, 1);
		assert.match(String((sent[0] as { content?: unknown }).content ?? ""), /Detached foreground run run-123/);
	});

	it("preserves /subagents-fleet without reserving a global shortcut by default", () => {
		const commands = new Map<string, RegisteredSlashCommand>();
		const shortcuts = new Map<string, unknown>();
		registerSlashCommands!({
			events: createEventBus(),
			registerCommand(name: string, spec: RegisteredSlashCommand) { commands.set(name, spec); },
			registerShortcut(key: string, spec: unknown) { shortcuts.set(key, spec); },
			sendMessage() {},
		}, createState(process.cwd()));
		assert.ok(commands.has("subagents-fleet"));
		assert.equal(shortcuts.size, 0);
	});

	it("/subagents-fleet loads and opens the Fleet view on first use", async () => {
		const commands = new Map<string, RegisteredSlashCommand>();
		registerSlashCommands!({
			events: createEventBus(),
			registerCommand(name: string, spec: RegisteredSlashCommand) { commands.set(name, spec); },
			registerShortcut() {},
			sendMessage() {},
		}, createState(process.cwd()));
		let opened = 0;
		await commands.get("subagents-fleet")!.handler("", createCommandContext({ hasUI: true, custom: async () => { opened += 1; return undefined; } }));
		assert.equal(opened, 1);
	});

	it("/run accepts an agent without a task", async () => {
		const sent: unknown[] = [];
		const commands = new Map<string, { handler(args: string, ctx: unknown): Promise<void> }>();
		const events = createEventBus();
		let requestedParams: unknown;
		let requestedCtx: unknown;
		const sessionManager = {
			flushed: false,
			rewrites: 0,
			getSessionFile: () => "session.jsonl",
			_rewriteFile() {
				this.rewrites++;
			},
		};
		events.on(SLASH_SUBAGENT_REQUEST_EVENT, (data) => {
			const payload = data as { requestId: string; params?: unknown; ctx?: unknown };
			requestedParams = payload.params;
			requestedCtx = payload.ctx;
			events.emit(SLASH_SUBAGENT_STARTED_EVENT, { requestId: payload.requestId });
			events.emit(SLASH_SUBAGENT_RESPONSE_EVENT, {
				requestId: payload.requestId,
				result: {
					content: [{ type: "text", text: "Commit finished" }],
					details: { mode: "single", results: [] },
				},
				isError: false,
			});
		});

		const pi = {
			events,
			registerCommand(name: string, spec: { handler(args: string, ctx: unknown): Promise<void> }) {
				commands.set(name, spec);
			},
			registerShortcut() {},
			sendMessage(message: unknown) {
				sent.push(message);
			},
		};

		const ctx = createCommandContext({ sessionManager });
		registerSlashCommands!(pi, createState(process.cwd()));
		await commands.get("run")!.handler("scout", ctx);
		await new Promise<void>((resolve) => setImmediate(resolve));

		assert.deepEqual(requestedParams, { workflowScript: "return runs.run(\"run\", {\"agent\":\"scout\",\"task\":\"\",\"agentScope\":\"both\"})", async: false });
		assert.equal(requestedCtx, ctx);
		assert.equal(sent.length, 2);
		assert.equal((sent[0] as { display?: boolean }).display, true);
		assert.equal((sent[0] as { content?: string }).content, "Running subagent...");
		assert.equal((sent[1] as { display?: boolean }).display, true);
		assert.match((sent[1] as { content?: string }).content ?? "", /Commit finished/);
		assert.equal(sessionManager.rewrites, 2);
		assert.equal(sessionManager.flushed, true);
	});

	it("/run abandons captured context when commands are disposed during reload", async () => {
		const sent: unknown[] = [];
		const commands = new Map<string, { handler(args: string, ctx: unknown): Promise<void> }>();
		const events = createEventBus();
		let deliverResponse: (() => void) | undefined;
		events.on(SLASH_SUBAGENT_REQUEST_EVENT, (data) => {
			const requestId = (data as { requestId: string }).requestId;
			events.emit(SLASH_SUBAGENT_STARTED_EVENT, { requestId });
			deliverResponse = () => events.emit(SLASH_SUBAGENT_RESPONSE_EVENT, {
				requestId,
				result: {
					content: [{ type: "text", text: "late result" }],
					details: { mode: "single", results: [] },
				},
				isError: false,
			});
		});

		const pi = {
			events,
			registerCommand(name: string, spec: { handler(args: string, ctx: unknown): Promise<void> }) {
				commands.set(name, spec);
			},
			registerShortcut() {},
			sendMessage(message: unknown) { sent.push(message); },
		};
		const disposer = registerSlashCommands!(pi, createState(process.cwd()));
		let stale = false;
		const ctx = createCommandContext({ hasUI: true });
		Object.defineProperty(ctx, "hasUI", {
			get() {
				if (stale) throw new Error("This extension ctx is stale after session replacement or reload.");
				return true;
			},
		});

		await commands.get("run")!.handler("scout Inspect this", ctx);
		assert.equal(sent.length, 1);
		stale = true;
		disposer.dispose();
		deliverResponse?.();
		await new Promise<void>((resolve) => setImmediate(resolve));

		assert.equal(sent.length, 1, "disposed slash work must not use the stale context for a final message");
	});

	it("/run handles a start timeout without an uninitialized finish callback", async () => {
		const sent: unknown[] = [];
		const commands = new Map<string, RegisteredSlashCommand>();
		const pi = {
			events: createEventBus(),
			registerCommand(name: string, spec: RegisteredSlashCommand) { commands.set(name, spec); },
			registerShortcut() {},
			sendMessage(message: unknown) { sent.push(message); },
		};
		const disposer = registerSlashCommands!(pi, createState(process.cwd()));
		const realSetTimeout = globalThis.setTimeout;
		let timeoutCalls = 0;
		const immediateTimeout = (...args: Parameters<typeof setTimeout>): ReturnType<typeof setTimeout> => {
			const [handler, delay, ...rest] = args;
			if (delay === 15_000) {
				timeoutCalls += 1;
				(handler as (...values: unknown[]) => void)(...rest);
				return 0 as ReturnType<typeof setTimeout>;
			}
			return realSetTimeout(...args);
		};
		globalThis.setTimeout = immediateTimeout;
		try {
			await commands.get("run")!.handler("scout Inspect this", createCommandContext());
			await new Promise<void>((resolve) => setImmediate(resolve));
		} finally {
			globalThis.setTimeout = realSetTimeout;
			disposer.dispose();
		}

		assert.equal(timeoutCalls, 1);
		assert.equal(sent.length, 2);
		assert.match((sent[1] as { content?: string }).content ?? "", /did not start within 15s/);
	});

	it("/run reports discovery evidence for a missing agent", async () => {
		await withTempProject("pi-slash-missing-agent-", async (root) => {
			fs.writeFileSync(path.join(root, ".pi", "agents", "worker.md"), "---\nname: worker\ndescription: Worker\n---\n", "utf-8");
			const run = await captureSlashCommandParams("run", "missing", root);
			assert.equal(run.params, undefined);
			assert.match(run.notifications[0] ?? "", /^Unknown agent: missing\nEffective cwd: /);
			assert.match(run.notifications[0] ?? "", /Consulted agent-definition directories:[\s\S]*worker \(project\)/);
		});
	});

	it("/run reports malformed agent configuration", async () => {
		await withTempProject("pi-slash-invalid-agent-", async (root) => {
			fs.writeFileSync(path.join(root, ".pi", "agents", "broken.md"), "---\nname: broken\ndescription: Broken\nrunner:\n  type: unknown\n---\nBroken agent.\n");

			const run = await captureSlashCommandParams("run", "broken", root);
			assert.equal(run.params, undefined);
			assert.match(run.notifications[0] ?? "", /Agent 'broken' has invalid configuration: Agent 'broken' uses removed frontmatter field 'runner'/);
		});
	});

	it("/run blocks a malformed project agent from falling back to builtin", async () => {
		await withTempProject("pi-slash-invalid-agent-shadow-", async (root) => {
			fs.writeFileSync(path.join(root, ".pi", "agents", "reviewer.md"), "---\nname: reviewer\ndescription: Broken reviewer\nrunner:\n  type: unknown\n---\nBroken agent.\n");

			const run = await captureSlashCommandParams("run", "reviewer", root);
			assert.equal(run.params, undefined);
			assert.match(run.notifications[0] ?? "", /Agent 'reviewer' has invalid configuration: Agent 'reviewer' uses removed frontmatter field 'runner'/);
		});
	});

	it("/run reports malformed packaged agent configuration by runtime name", async () => {
		await withTempProject("pi-slash-invalid-packaged-agent-", async (root) => {
			fs.writeFileSync(path.join(root, ".pi", "agents", "code-analysis.zeta-worker.md"), "---\nname: zeta-worker\npackage: code-analysis\ndescription: Broken packaged worker\nrunner:\n  type: unknown\n---\nBroken agent.\n");

			const run = await captureSlashCommandParams("run", "code-analysis.zeta-worker", root);
			assert.equal(run.params, undefined);
			assert.match(run.notifications[0] ?? "", /Agent 'code-analysis\.zeta-worker' has invalid configuration: Agent 'zeta-worker' uses removed frontmatter field 'runner'/);
		});
	});

	it("/run preserves existing relative reads and omits missing reads", async () => {
		await withTempProject("pi-slash-reads-", async (root) => {
			fs.writeFileSync(path.join(root, ".pi", "agents", "scout.md"), `---
name: scout
description: Scout
---

Inspect
`, "utf-8");
			fs.writeFileSync(path.join(root, "context.md"), "context");

			const run = await captureSlashCommandParams("run", "scout[reads=context.md+missing.md] Inspect", root);
			assert.deepEqual(run.params, {
				workflowScript: "return runs.run(\"run\", {\"agent\":\"scout\",\"task\":\"[Read from: context.md]\\n\\nInspect\",\"agentScope\":\"both\"})",
				async: false,
			});
		});
	});

	it("/run finalizes the slash snapshot before the last UI redraw on success", async () => {
		const sent: unknown[] = [];
		const log: string[] = [];
		const commands = new Map<string, { handler(args: string, ctx: unknown): Promise<void> }>();
		const events = createEventBus();
		events.on(SLASH_SUBAGENT_REQUEST_EVENT, (data) => {
			const requestId = (data as { requestId: string }).requestId;
			events.emit(SLASH_SUBAGENT_STARTED_EVENT, { requestId });
			events.emit(SLASH_SUBAGENT_RESPONSE_EVENT, {
				requestId,
				result: {
					content: [{ type: "text", text: "Scout finished" }],
					details: { mode: "single", results: [{ sessionFile: "/tmp/child-session.jsonl" }] },
				},
				isError: false,
			});
		});

		const pi = {
			events,
			registerCommand(name: string, spec: { handler(args: string, ctx: unknown): Promise<void> }) {
				commands.set(name, spec);
			},
			registerShortcut() {},
			sendMessage(message: unknown) {
				sent.push(message);
				log.push(`send:${(message as { display?: boolean }).display === false ? "hidden" : "visible"}`);
			},
		};

		registerSlashCommands!(pi, createState(process.cwd()));
		await commands.get("run")!.handler("scout inspect this", createCommandContext({
			hasUI: true,
			setStatus: (_key, text) => {
				log.push(`status:${text ?? "clear"}`);
			},
		}));
		await new Promise<void>((resolve) => setImmediate(resolve));

		assert.equal(sent.length, 2);
		assert.equal((sent[0] as { customType?: string; display?: boolean }).customType, SLASH_RESULT_TYPE);
		assert.equal((sent[0] as { display?: boolean }).display, true);
		assert.equal((sent[0] as { content?: string }).content, "inspect this");
		assert.equal((sent[1] as { customType?: string; display?: boolean }).customType, SLASH_RESULT_TYPE);
		assert.equal((sent[1] as { display?: boolean }).display, false);
		assert.match((sent[1] as { content?: string }).content ?? "", /Scout finished/);
		assert.match((sent[1] as { content?: string }).content ?? "", /Child session exports\n\n- `\/tmp\/child-session\.jsonl`/);
		assert.deepEqual(log, ["send:visible", "status:running...", "send:hidden", "status:clear"]);

		const visibleDetails = resolveSlashMessageDetails!((sent[0] as { details?: unknown }).details);
		assert.ok(visibleDetails);
		const visibleSnapshot = getSlashRenderableSnapshot!(visibleDetails!);
		assert.equal((visibleSnapshot.result.content[0] as { text?: string }).text, "Scout finished");
	});

	it("/run collapses tool detail before showing the initial live card", async () => {
		const log: string[] = [];
		const commands = new Map<string, { handler(args: string, ctx: unknown): Promise<void> }>();
		const events = createEventBus();
		events.on(SLASH_SUBAGENT_REQUEST_EVENT, (data) => {
			const requestId = (data as { requestId: string }).requestId;
			events.emit(SLASH_SUBAGENT_STARTED_EVENT, { requestId });
			events.emit(SLASH_SUBAGENT_RESPONSE_EVENT, {
				requestId,
				result: { content: [{ type: "text", text: "done" }], details: { mode: "single", results: [] } },
				isError: false,
			});
		});

		const pi = {
			events,
			registerCommand(name: string, spec: { handler(args: string, ctx: unknown): Promise<void> }) {
				commands.set(name, spec);
			},
			registerShortcut() {},
			sendMessage() {
				log.push("send");
			},
		};

		registerSlashCommands!(pi, createState(process.cwd()));
		await commands.get("run")!.handler("scout inspect this", createCommandContext({
			hasUI: true,
			setToolsExpanded: (expanded) => log.push(`expanded:${String(expanded)}`),
		}));

		assert.deepEqual(log.slice(0, 2), ["expanded:false", "send"]);
	});

	it("/run finalizes the slash snapshot before the last UI redraw on error", async () => {
		const sent: unknown[] = [];
		const log: string[] = [];
		const commands = new Map<string, { handler(args: string, ctx: unknown): Promise<void> }>();
		const events = createEventBus();
		events.on(SLASH_SUBAGENT_REQUEST_EVENT, (data) => {
			const requestId = (data as { requestId: string }).requestId;
			events.emit(SLASH_SUBAGENT_STARTED_EVENT, { requestId });
			events.emit(SLASH_SUBAGENT_RESPONSE_EVENT, {
				requestId,
				result: {
					content: [{ type: "text", text: "Subagent failed" }],
					details: { mode: "single", results: [] },
				},
				isError: true,
				errorText: "Subagent failed",
			});
		});

		const pi = {
			events,
			registerCommand(name: string, spec: { handler(args: string, ctx: unknown): Promise<void> }) {
				commands.set(name, spec);
			},
			registerShortcut() {},
			sendMessage(message: unknown) {
				sent.push(message);
				log.push(`send:${(message as { display?: boolean }).display === false ? "hidden" : "visible"}`);
			},
		};

		registerSlashCommands!(pi, createState(process.cwd()));
		await commands.get("run")!.handler("scout inspect this", createCommandContext({
			hasUI: true,
			setStatus: (_key, text) => {
				log.push(`status:${text ?? "clear"}`);
			},
		}));
		await new Promise<void>((resolve) => setImmediate(resolve));

		assert.equal(sent.length, 2);
		assert.equal((sent[0] as { customType?: string; display?: boolean }).customType, SLASH_RESULT_TYPE);
		assert.equal((sent[0] as { display?: boolean }).display, true);
		assert.equal((sent[0] as { content?: string }).content, "inspect this");
		assert.equal((sent[1] as { customType?: string; display?: boolean }).customType, SLASH_RESULT_TYPE);
		assert.equal((sent[1] as { display?: boolean }).display, false);
		assert.match((sent[1] as { content?: string }).content ?? "", /Subagent failed/);
		assert.deepEqual(log, ["send:visible", "status:running...", "send:hidden", "status:clear"]);

		const visibleDetails = resolveSlashMessageDetails!((sent[0] as { details?: unknown }).details);
		assert.ok(visibleDetails);
		const visibleSnapshot = getSlashRenderableSnapshot!(visibleDetails!);
		assert.equal((visibleSnapshot.result.content[0] as { text?: string }).text, "Subagent failed");
	});

	it("/run accepts dotted packaged runtime agent names", async () => {
		await withTempProject("pi-packaged-agent-slash-", async (root) => {
			fs.writeFileSync(path.join(root, ".pi", "agents", "code-analysis.scout.md"), `---
name: scout
package: code-analysis
description: Fast recon
---

Inspect
`, "utf-8");

			const run = await captureSlashCommandParams("run", "code-analysis.scout Investigate", root);
			assert.deepEqual(run.params, { workflowScript: "return runs.run(\"run\", {\"agent\":\"code-analysis.scout\",\"task\":\"Investigate\",\"agentScope\":\"both\"})", async: false });

			await withIsolatedHome(async () => {
				const commands = new Map<string, RegisteredSlashCommand>();
				registerSlashCommands!({
					events: createEventBus(),
					registerCommand(name: string, spec: RegisteredSlashCommand) { commands.set(name, spec); },
					registerShortcut() {},
					sendMessage() {},
				} as never, createState(root));
				const completions = commands.get("run")!.getArgumentCompletions!("code-") as Array<{ value: string }>;
				assert.deepEqual(completions.map(({ value }) => value), ["code-analysis.scout"]);
			});
		});
	});

	it("/run reports malformed packaged local-name fallback configuration", async () => {
		await withTempProject("pi-packaged-agent-local-slash-", async (root) => {
			const highPackage = path.join(root, "high-package");
			const lowPackage = path.join(root, "low-package");
			for (const packageRoot of [highPackage, lowPackage]) {
				fs.mkdirSync(path.join(packageRoot, "agents"), { recursive: true });
				fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ "pi-subagents": { agents: ["agents"] } }));
			}
			fs.writeFileSync(path.join(highPackage, "agents", "foo.md"), `---
name: foo
package: acme
description: Broken high package foo
runner:
  type: unknown
---
Broken foo.
`, "utf-8");
			fs.writeFileSync(path.join(lowPackage, "agents", "foo.md"), `---
name: foo
package: acme
description: Valid low package foo
---
Valid foo.
`, "utf-8");
			fs.writeFileSync(path.join(root, ".pi", "settings.json"), JSON.stringify({ packages: [highPackage, lowPackage] }));

			const run = await captureSlashCommandParams("run", "foo Investigate", root);
			assert.equal(run.params, undefined);
			assert.match(run.notifications[0] ?? "", /Agent 'foo' has invalid configuration: Agent 'foo' uses removed frontmatter field 'runner'/);
		});
	});

	it("does not register legacy orchestration commands", async () => {
		const commands = new Map<string, unknown>();
		registerSlashCommands!({
			registerCommand(name: string, command: unknown) { commands.set(name, command); },
			registerShortcut() {},
			events: createEventBus(),
		} as never, { baseCwd: process.cwd() } as never);
		assert.equal(commands.has("run"), true);
		assert.equal(commands.has("chain"), false);
		assert.equal(commands.has("parallel"), false);
		assert.equal(commands.has("run-chain"), false);
	});
});
