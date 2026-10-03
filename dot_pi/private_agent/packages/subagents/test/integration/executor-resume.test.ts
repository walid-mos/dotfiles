import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { ASYNC_DIR, INTERCOM_DETACH_REQUEST_EVENT, RESULTS_DIR, SUBAGENT_ASYNC_STARTED_EVENT, SUBAGENT_FOREGROUND_COMPLETE_EVENT } from "../../src/shared/types.ts";
import { ACTIVE_ASYNC_CAPACITY_DIR, acquireActiveAsyncCapacity, activeAsyncCapacitySessionKey, getActiveAsyncCapacitySnapshot } from "../../src/runs/background/active-async-capacity.ts";
import { waitForSubagents } from "../../src/runs/background/subagent-wait.ts";
import { createRunFanoutBudget } from "../../src/runs/shared/run-fanout-budget.ts";
import { acquireSessionLease, sessionLeaseDir } from "../../src/runs/shared/session-lease.ts";
import type { MockPi } from "../support/helpers.ts";
import {
	createMockPi,
	createTempDir,
	events,
	makeAgent,
	makeMinimalCtx,
	removeTempDir,
	tryImport,
} from "../support/helpers.ts";

interface ExecutorResult {
	content: Array<{ text?: string }>;
	isError?: boolean;
	details?: {
		mode?: string;
		runId?: string;
		results?: Array<{ agent?: string; finalOutput?: string; outputState?: string; sessionFile?: string; acceptance?: { status?: string }; artifactPaths?: { metadataPath?: string } }>;
		asyncId?: string;
		workflow?: { value?: unknown };
	};
}

interface ExecutorModule {
	createSubagentExecutor?: (...args: unknown[]) => {
		execute: (
			id: string,
			params: Record<string, unknown>,
			signal: AbortSignal,
			onUpdate: ((result: unknown) => void) | undefined,
			ctx: unknown,
		) => Promise<ExecutorResult>;
	};
}

const executorMod = await tryImport<ExecutorModule>("./src/runs/foreground/subagent-executor.ts");
const available = !!executorMod?.createSubagentExecutor;
const createSubagentExecutor = executorMod?.createSubagentExecutor;

function createRecordingEventBus() {
	const listeners = new Map<string, Set<(payload: unknown) => void>>();
	const emitted: Array<{ channel: string; payload: unknown }> = [];
	const bus = {
		emitted,
		on(channel: string, handler: (payload: unknown) => void) {
			const channelListeners = listeners.get(channel) ?? new Set();
			channelListeners.add(handler);
			listeners.set(channel, channelListeners);
			return () => {
				channelListeners.delete(handler);
				if (channelListeners.size === 0) listeners.delete(channel);
			};
		},
		emit(channel: string, payload: unknown) {
			emitted.push({ channel, payload });
			for (const handler of listeners.get(channel) ?? []) {
				handler(payload);
			}
		},
	};
	return bus;
}

describe("executor resume and supervisor bridge", { skip: !available ? "executor not importable" : undefined }, () => {
	let tempDir: string;
	let homeDir: string;
	let mockPi: MockPi;
	let originalHome: string | undefined;
	let originalUserProfile: string | undefined;
	let budgetDirectories: string[] = [];

	before(() => {
		originalHome = process.env.HOME;
		originalUserProfile = process.env.USERPROFILE;
		homeDir = createTempDir("pi-subagent-intercom-home-");
		process.env.HOME = homeDir;
		process.env.USERPROFILE = homeDir;
		mockPi = createMockPi();
		mockPi.install();
	});

	after(() => {
		mockPi.uninstall();
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
		if (originalUserProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = originalUserProfile;
		removeTempDir(homeDir);
	});

	beforeEach(() => {
		tempDir = createTempDir("pi-subagent-intercom-result-");
		mockPi.reset();
	});

	afterEach(() => {
		removeTempDir(tempDir);
		for (const directory of budgetDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
	});

	async function readMockCallArgs(index: number): Promise<string[]> {
		const deadline = Date.now() + 10_000;
		let callFile: string | undefined;
		let parseError: SyntaxError | undefined;
		while (Date.now() <= deadline) {
			callFile = fs.readdirSync(mockPi.dir)
				.filter((name) => name.startsWith("call-") && name.endsWith(".json"))
				.sort()[index];
			if (callFile) {
				try {
					return JSON.parse(fs.readFileSync(path.join(mockPi.dir, callFile), "utf-8")).args as string[];
				} catch (error) {
					if (!(error instanceof SyntaxError)) throw error;
					parseError = error;
				}
			}
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		if (callFile && parseError) {
			throw new Error(`Mock Pi call record '${callFile}' remained incomplete after 10s.`, { cause: parseError });
		}
		assert.fail(`expected mock pi call at index ${index}`);
	}

	async function waitForFile(filePath: string, timeoutMs = 10_000): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		while (!fs.existsSync(filePath)) {
			if (Date.now() > deadline) assert.fail(`Timed out waiting for file: ${filePath}`);
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	}

	async function waitForCallCount(minimum: number, timeoutMs = 10_000): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		while (mockPi.callCount() < minimum) {
			if (Date.now() > deadline) assert.fail(`Timed out waiting for ${minimum} mock pi calls; saw ${mockPi.callCount()}`);
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	}

	async function waitForMissingPath(filePath: string, timeoutMs = 10_000): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		while (fs.existsSync(filePath)) {
			if (Date.now() > deadline) assert.fail(`Timed out waiting for path cleanup: ${filePath}`);
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	}

	async function waitForStatus(filePath: string, predicate: (status: any) => boolean, timeoutMs = 10_000): Promise<any> {
		const deadline = Date.now() + timeoutMs;
		let lastStatus: any;
		while (Date.now() <= deadline) {
			if (fs.existsSync(filePath)) {
				lastStatus = JSON.parse(fs.readFileSync(filePath, "utf-8"));
				if (predicate(lastStatus)) return lastStatus;
			}
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		assert.fail(`Timed out waiting for status at ${filePath}; last status: ${JSON.stringify(lastStatus)}`);
	}

	function writeRecoveryDescriptor(asyncDir: string, runId: string, agent = "worker", overrides: Record<string, unknown> = {}): void {
		const runFanoutBudget = createRunFanoutBudget(runId, 64);
		budgetDirectories.push(runFanoutBudget.directory);
		fs.writeFileSync(path.join(asyncDir, "recovery-descriptor.json"), JSON.stringify({
			version: 1,
			runFanoutBudget,
			sourceRunId: runId,
			agent,
			cwd: tempDir,
			systemPromptMode: "replace",
			inheritProjectContext: false,
			inheritSkills: false,
			outputMode: "inline",
			maxSubagentDepth: 2,
			...overrides,
		}, null, 2), "utf-8");
	}

	function makeExecutor(options: { bridgeMode?: "always" | "off"; agents?: ReturnType<typeof makeAgent>[]; kill?: (pid: number, signal?: NodeJS.Signals | 0) => boolean; maxActiveAsyncRunsPerSession?: number } = {}) {
		const events = createRecordingEventBus();
		const state = {
			baseCwd: tempDir,
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
		const executor = createSubagentExecutor!({
			pi: {
				events,
				getSessionName: () => "orchestrator",
				setSessionName: () => {},
			},
			state,
			config: {
				intercomBridge: {
					mode: options.bridgeMode ?? "always",
				},
				...(options.maxActiveAsyncRunsPerSession === undefined ? {} : { maxActiveAsyncRunsPerSession: options.maxActiveAsyncRunsPerSession }),
			},
			asyncByDefault: false,
			tempArtifactsDir: tempDir,
			getSubagentSessionRoot: () => tempDir,
			expandTilde: (value: string) => value,
			discoverAgents: () => ({ agents: options.agents ?? [makeAgent("worker")] }),
			kill: options.kill,
		});
		return { executor, events, state };
	}

	it("keeps a workflow child bridge override isolated and preserves final output", async () => {
		mockPi.onCall({ matchArgIncludes: "isolated task", output: "Isolated child output" });
		mockPi.onCall({ matchArgIncludes: "normal task", output: "Normal child output" });
		const { executor } = makeExecutor({ agents: [makeAgent("worker", { tools: ["read"] })] });

		const result = await executor.execute(
			"workflow-intercom-override",
			{
				workflowScript: `const isolated = await runs.run("isolated", { agent: "worker", task: "isolated task", intercomBridge: { mode: "off" } }); const normal = await runs.run("normal", { agent: "worker", task: "normal task" }); return { isolated: isolated.output, normal: normal.output };`,
				async: false,
			},
			new AbortController().signal,
			undefined,
			makeMinimalCtx(tempDir),
		);

		const isolatedArgs = await readMockCallArgs(0);
		const normalArgs = await readMockCallArgs(1);
		assert.equal(isolatedArgs[isolatedArgs.indexOf("--tools") + 1], "read");
		assert.equal(normalArgs[normalArgs.indexOf("--tools") + 1], "read,contact_supervisor");
		assert.deepEqual(result.details?.workflow?.value, { isolated: "Isolated child output", normal: "Normal child output" });
	});

	it("waits for retained workflow resume loops and returns each completed revived child", async () => {
		mockPi.onCall({ output: "Completed retained follow-up one" });
		mockPi.onCall({ output: "Completed retained follow-up two" });
		const sourceRunId = `workflow-resume-source-${Date.now()}`;
		const sourceAsyncDir = path.join(ASYNC_DIR, sourceRunId);
		const sessionFile = path.join(tempDir, "workflow-resume-session.jsonl");
		let revivedIds: string[] = [];
		try {
			fs.mkdirSync(sourceAsyncDir, { recursive: true });
			fs.writeFileSync(sessionFile, "", "utf-8");
			fs.writeFileSync(path.join(sourceAsyncDir, "status.json"), JSON.stringify({
				runId: sourceRunId,
				sessionId: "session-123",
				mode: "single",
				state: "complete",
				startedAt: 100,
				lastUpdate: 200,
				cwd: tempDir,
				sessionFile,
				steps: [{ agent: "worker", status: "complete", sessionFile }],
			}, null, 2), "utf-8");
			writeRecoveryDescriptor(sourceAsyncDir, sourceRunId);
			const { executor } = makeExecutor();

			const result = await executor.execute(
				"workflow-retained-resume",
				{
					workflowScript: `const first = await runs.run("followup-1", { resume: "${sourceRunId}", task: "Continue once" }); const second = await runs.run("followup-2", { resume: first.runId, task: "Continue twice" }); return { firstRunId: first.runId, firstOutput: first.output, runId: second.runId, output: second.output };`,
					async: false,
				},
				new AbortController().signal,
				undefined,
				makeMinimalCtx(tempDir),
			);

			assert.equal(result.isError, undefined, result.content[0]?.text);
			assert.match(result.content[0]?.text ?? "", /Completed retained follow-up two/);
			assert.doesNotMatch(result.content[0]?.text ?? "", /detached and running in the background/);
			const value = result.details?.workflow?.value as { firstRunId?: string; firstOutput?: string; runId?: string; output?: string } | undefined;
			revivedIds = [value?.firstRunId, value?.runId].filter((id): id is string => Boolean(id));
			assert.equal(revivedIds.length, 2);
			assert.notEqual(revivedIds[0], sourceRunId);
			assert.notEqual(revivedIds[1], revivedIds[0], "expected the latest revived run id from pass two");
			assert.equal(value?.firstOutput, "Completed retained follow-up one");
			assert.equal(value?.output, "Completed retained follow-up two");
			// Awaiting may consume a pending result before the runner promotes its public file.
			assert.equal(mockPi.callCount(), 2, "each retained follow-up must execute once without replay or extra children");
		} finally {
			fs.rmSync(sourceAsyncDir, { recursive: true, force: true });
			for (const id of revivedIds) fs.rmSync(path.join(ASYNC_DIR, id), { recursive: true, force: true });
		}
	});

	it("cleans an attached single rejection and its temporary structured runtime", async () => {
		mockPi.onCall({
			stdoutRaw: [
				{ type: "tool_execution_start", toolName: "structured_output", args: { value: { ok: true } } },
				{ type: "tool_result_end", message: { role: "toolResult", toolName: "structured_output", content: [{ type: "text", text: "Structured output captured." }] } },
				{ type: "tool_execution_end", toolName: "structured_output" },
			].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
			structuredOutputCapture: { ok: true },
		});
		const { executor, state } = makeExecutor({ bridgeMode: "off", agents: [makeAgent("worker")] });
		let structuredDir: string | undefined;
		const result = await executor.execute(
			"single-rejection-cleanup",
			{ agent: "worker", task: "structured task", artifacts: false, outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] } },
			new AbortController().signal,
			(update: { details?: { results?: Array<{ structuredOutputPath?: string }>; progress?: Array<{ status?: string }> } }) => {
				const outputPath = update.details?.results?.[0]?.structuredOutputPath;
				if (outputPath) structuredDir = path.dirname(outputPath);
				if (update.details?.progress?.[0]?.status === "completed") throw new Error("reject attached single completion");
			},
			makeMinimalCtx(tempDir),
		);
		assert.equal(result.isError, true);
		assert.equal(state.foregroundControls.size, 0);
		assert.ok(structuredDir);
		assert.equal(fs.existsSync(structuredDir), false, "temporary structured runtime must be removed on rejection");
	});





	it("resume action rejects a live async child without side effects", async () => {
		const runId = `resume-live-${Date.now()}`;
		const asyncDir = path.join(ASYNC_DIR, runId);
		const kills: Array<{ pid: number; signal?: NodeJS.Signals | 0 }> = [];
		try {
			fs.mkdirSync(asyncDir, { recursive: true });
			fs.writeFileSync(path.join(asyncDir, "status.json"), JSON.stringify({
				runId,
				sessionId: "session-123",
				mode: "single",
				state: "running",
				runnerPid: process.pid,
				startedAt: 100,
				lastUpdate: Date.now(),
				steps: [{ agent: "worker", status: "running" }],
			}, null, 2), "utf-8");
			const { executor } = makeExecutor({
				kill: (pid, signal) => {
					kills.push({ pid, signal });
					return true;
				},
			});

			const result = await executor.execute(
				"resume-live",
				{ action: "resume", id: runId, message: "Can you clarify the last change?" },
				new AbortController().signal,
				undefined,
				makeMinimalCtx(tempDir),
			);

			assert.equal(result.isError, true);
			assert.match(result.content[0]?.text ?? "", new RegExp(`Async child '${runId}' index 0 is still running`));
			assert.match(result.content[0]?.text ?? "", new RegExp(`subagent\\(\\{ action: "steer", id: "${runId}", index: 0, message: "\\.\\.\\." \\}\\)`));
			assert.deepEqual(kills, []);
			assert.equal(fs.existsSync(path.join(asyncDir, "control", "interrupt.json")), false);
		} finally {
			fs.rmSync(asyncDir, { recursive: true, force: true });
		}
	});

	it("resume action rejects async runs from another or missing parent session", async () => {
		for (const [suffix, sessionId] of [["other", "another-session"], ["missing", undefined]] as const) {
			const runId = `resume-${suffix}-session-${Date.now()}`;
			const asyncDir = path.join(ASYNC_DIR, runId);
			try {
				fs.mkdirSync(asyncDir, { recursive: true });
				fs.writeFileSync(path.join(asyncDir, "status.json"), JSON.stringify({
					runId,
					...(sessionId ? { sessionId } : {}),
					mode: "single",
					state: "running",
					runnerPid: process.pid,
					startedAt: 100,
					lastUpdate: Date.now(),
					steps: [{ agent: "worker", status: "running" }],
				}, null, 2), "utf-8");
				const { executor } = makeExecutor();

				const result = await executor.execute(
					`resume-${suffix}-session`,
					{ action: "resume", id: runId, message: "Continue" },
					new AbortController().signal,
					undefined,
					makeMinimalCtx(tempDir),
				);

				assert.equal(result.isError, true);
				assert.match(result.content[0]?.text ?? "", /not found in the active session/);
				assert.equal(mockPi.callCount(), 0);
			} finally {
				fs.rmSync(asyncDir, { recursive: true, force: true });
			}
		}
	});

	it("resume action rejects explicit reviewed acceptance before launching", async () => {
		for (const [index, params] of [
			{ message: "Continue", acceptance: "reviewed" },
		].entries()) {
			const { executor, events } = makeExecutor({ agents: [makeAgent("reviewer")] });
			const result = await executor.execute(
				`resume-invalid-acceptance-${index}`,
				{ action: "resume", id: "missing-source-run", ...params },
				new AbortController().signal,
				undefined,
				makeMinimalCtx(tempDir),
			);

			assert.equal(result.isError, true);
			assert.match(result.content[0]?.text ?? "", /Cannot resume:.*achieved status.*acceptance\.review\.required/i);
			assert.equal(events.emitted.some((entry) => entry.channel === SUBAGENT_ASYNC_STARTED_EVENT), false);
		}
	});

	it("resume action rejects malformed explicit output schemas before lookup", async () => {
		for (const [index, params] of [
			{ message: "Continue", outputSchema: true },
			{ message: "Continue", outputSchema: null },
		].entries()) {
			const { executor, events } = makeExecutor();
			const result = await executor.execute(
				`resume-invalid-schema-${index}`,
				{ action: "resume", id: "missing-source-run", ...params },
				new AbortController().signal,
				undefined,
				makeMinimalCtx(tempDir),
			);
			assert.equal(result.isError, true);
			assert.match(result.content[0]?.text ?? "", /Cannot resume: outputSchema must be a JSON Schema object/);
			assert.equal(events.emitted.some((entry) => entry.channel === SUBAGENT_ASYNC_STARTED_EVENT), false);
		}
	});

	it("rejects either false-schema report polarity before acquiring resume capacity", async () => {
		const schema = { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } };
		for (const report of ["on", "off"] as const) {
			for (const polarity of ["retained-false", "explicit-false"] as const) {
				const parentSessionId = `session-resume-${polarity}-${report}-${Date.now()}`;
				try {
					const { executor, events } = makeExecutor({ maxActiveAsyncRunsPerSession: 1 });
					const ctx = makeMinimalCtx(tempDir);
					ctx.sessionManager.getSessionId = () => parentSessionId;
					if (polarity === "retained-false") {
						mockPi.onCall({ output: "unstructured result" });
					} else {
						const structuredEvents = [
							{ type: "tool_execution_start", toolName: "structured_output", args: { value: { ok: true } } },
							{ type: "tool_result_end", message: { role: "toolResult", toolName: "structured_output", content: [{ type: "text", text: "Structured output captured." }] } },
							{ type: "tool_execution_end", toolName: "structured_output" },
						];
						mockPi.onCall({
							stdoutRaw: structuredEvents.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
							structuredOutputCapture: { ok: true },
						});
					}
					const first = await executor.execute(
						`resume-${polarity}-${report}-source`,
						polarity === "retained-false"
							? { agent: "worker", task: "Return prose", async: false, outputSchema: false, acceptance: false }
							: { agent: "worker", task: "Return data", async: false, outputSchema: schema, acceptance: { level: "checked", report } },
						new AbortController().signal,
						undefined,
						ctx,
					);
					if (polarity === "retained-false") assert.equal(first.isError, undefined, first.content[0]?.text ?? "source run failed");
					assert.ok(first.details.runId);
					assert.deepEqual(getActiveAsyncCapacitySnapshot(parentSessionId, 1), { used: 0, limit: 1 });
					const result = await executor.execute(
						`resume-${polarity}-${report}`,
						polarity === "retained-false"
							? { action: "resume", id: first.details.runId, message: "Continue", acceptance: { level: "checked", report } }
							: { action: "resume", id: first.details.runId, message: "Continue", outputSchema: false },
						new AbortController().signal,
						undefined,
						ctx,
					);
					assert.equal(result.isError, true);
					assert.match(result.content[0]?.text ?? "", /Cannot resume: acceptance\.report requires outputSchema/);
					assert.deepEqual(getActiveAsyncCapacitySnapshot(parentSessionId, 1), { used: 0, limit: 1 });
					assert.equal(mockPi.callCount(), 1);
					assert.equal(events.emitted.some((entry) => entry.channel === SUBAGENT_ASYNC_STARTED_EVENT), false);
				} finally {
					fs.rmSync(path.join(ACTIVE_ASYNC_CAPACITY_DIR, activeAsyncCapacitySessionKey(parentSessionId)), { recursive: true, force: true });
					mockPi.reset();
				}
			}
		}
	});

	for (const workflow of [false, true]) it(`${workflow ? "workflow string resume" : "resume action"} revives completed multi-child async runs by index`, async () => {
		mockPi.onCall({ output: "revived async child b" });
		const runId = `resume-revive-multi-${Date.now()}`;
		const asyncDir = path.join(ASYNC_DIR, runId);
		const firstSession = path.join(tempDir, "child-a.jsonl");
		const secondSession = path.join(tempDir, "child-b.jsonl");
		try {
			fs.mkdirSync(asyncDir, { recursive: true });
			fs.writeFileSync(firstSession, "", "utf-8");
			fs.writeFileSync(secondSession, "", "utf-8");
			fs.writeFileSync(path.join(asyncDir, "status.json"), JSON.stringify({
				runId,
				sessionId: "session-123",
				mode: "parallel",
				state: "complete",
				startedAt: 100,
				lastUpdate: 200,
				cwd: tempDir,
				steps: [
					{ agent: "a", status: "complete", sessionFile: firstSession },
					{ agent: "b", status: "complete", sessionFile: secondSession, model: "anthropic/claude-sonnet-4", thinking: "high" },
				],
			}, null, 2), "utf-8");
			writeRecoveryDescriptor(asyncDir, runId, "b", { model: "anthropic/claude-sonnet-4:high" });
			const { executor } = makeExecutor({ agents: [makeAgent("a"), makeAgent("b")] });

			const result = await executor.execute(
				"resume-revive-multi",
				workflow
					? { async: false, workflowScript: `return runs.run("indexed", { resume: ${JSON.stringify(runId)}, index: 1, task: "What did b find?", output: false });` }
					: { action: "resume", id: runId, index: 1, message: "What did b find?" },
				new AbortController().signal,
				undefined,
				makeMinimalCtx(tempDir),
			);

			assert.equal(result.isError, undefined, result.content[0]?.text);
			if (workflow) {
				const child = result.details!.workflow!.value as { runId: string; agent: string; continuation: { runIds: string[] } };
				assert.equal(child.agent, "b");
				assert.deepEqual(child.continuation.runIds, [runId, child.runId]);
				assert.deepEqual(result.details!.workflow!.receipt!.entries.indexed.continuation, child.continuation);
			} else {
				assert.match(result.content[0]?.text ?? "", /Revived async subagent from/);
				assert.match(result.details?.asyncId ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
				assert.match(result.content[0]?.text ?? "", /Agent: b/);
				assert.match(result.content[0]?.text ?? "", new RegExp(secondSession.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
			}
			const args = await readMockCallArgs(0);
			assert.equal(args[args.indexOf("--session") + 1], secondSession);
			assert.equal(args[args.indexOf("--model") + 1], "anthropic/claude-sonnet-4:high");
		} finally {
			fs.rmSync(asyncDir, { recursive: true, force: true });
		}
	});

	it("resume action revives completed async runs with no-poll handoff guidance", async () => {
		mockPi.onCall({ output: "revived answer" });
		const runId = `resume-revive-${Date.now()}`;
		const asyncDir = path.join(ASYNC_DIR, runId);
		const sessionFile = path.join(tempDir, "child-session.jsonl");
		try {
			fs.mkdirSync(asyncDir, { recursive: true });
			fs.writeFileSync(sessionFile, "", "utf-8");
			fs.writeFileSync(path.join(asyncDir, "status.json"), JSON.stringify({
				runId,
				sessionId: "session-123",
				mode: "single",
				state: "complete",
				startedAt: 100,
				lastUpdate: 200,
				cwd: tempDir,
				sessionFile,
				steps: [{ agent: "worker", status: "complete", launchContractDigest: "source-launch-contract-digest" }],
			}, null, 2), "utf-8");
			writeRecoveryDescriptor(asyncDir, runId, "worker", { launchContractDigest: "source-launch-contract-digest" });
			const { executor, events } = makeExecutor();

			const result = await executor.execute(
				"resume-revive",
				{ action: "resume", id: runId, message: "What changed?" },
				new AbortController().signal,
				undefined,
				makeMinimalCtx(tempDir),
			);

			assert.equal(result.isError, undefined);
			assert.match(result.content[0]?.text ?? "", /Revived async subagent from/);
			assert.match(result.content[0]?.text ?? "", /Do not run sleep timers or polling loops/);
			assert.match(result.content[0]?.text ?? "", /Use bg_wait only/);
			assert.match(result.content[0]?.text ?? "", /Status if needed: subagent\(\{ action: "status"/);
			assert.doesNotMatch(result.content[0]?.text ?? "", /Follow:/);
			const revivedId = result.details?.asyncId;
			assert.ok(revivedId, "expected revived async id");
			assert.equal(result.details?.sourceLaunchContractDigest, "source-launch-contract-digest");
			const startedEvent = events.emitted.find((entry) => entry.channel === SUBAGENT_ASYNC_STARTED_EVENT && (entry.payload as { id?: string }).id === revivedId)?.payload as { goal?: string } | undefined;
			assert.equal(startedEvent?.goal, "[prompt redacted]");
			const resultPath = path.join(RESULTS_DIR, `${revivedId}.json`);
			const deadline = Date.now() + 10_000;
			while (!fs.existsSync(resultPath)) {
				if (Date.now() > deadline) assert.fail(`Timed out waiting for revived result file: ${resultPath}`);
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
		} finally {
			fs.rmSync(asyncDir, { recursive: true, force: true });
		}
	});

	it("resume action on a failed workflow child makes the revival that key's latest run", async () => {
		mockPi.onCall({ output: "revived memory report" });
		const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
		const workflowRunId = `revive-workflow-${suffix}`;
		const childRunId = `revive-workflow-child-${suffix}`;
		const workflowDir = path.join(ASYNC_DIR, workflowRunId);
		const childDir = path.join(ASYNC_DIR, childRunId);
		const sessionFile = path.join(tempDir, "memory-child.jsonl");
		const cleanup = [workflowDir, childDir];
		try {
			fs.mkdirSync(workflowDir, { recursive: true });
			fs.mkdirSync(childDir, { recursive: true });
			fs.writeFileSync(sessionFile, "", "utf-8");
			fs.writeFileSync(path.join(workflowDir, "status.json"), JSON.stringify({
				runId: workflowRunId, sessionId: "session-123", mode: "workflow", state: "complete", startedAt: 100, endedAt: 300, cwd: tempDir,
				steps: [{ agent: "worker", workflowKey: "memory", runId: childRunId, status: "failed", error: "429 rate limit" }],
			}), "utf-8");
			fs.writeFileSync(path.join(workflowDir, "workflow-receipt.json"), JSON.stringify({
				version: 1, workflowRunId, state: "complete", createdAt: 300,
				entries: { memory: { key: "memory", agent: "worker", latestRunId: childRunId, continuation: { runIds: [childRunId] }, resumability: { state: "resumable" } } },
			}), "utf-8");
			fs.writeFileSync(path.join(childDir, "status.json"), JSON.stringify({
				runId: childRunId, sessionId: "session-123", mode: "single", state: "failed", startedAt: 100, endedAt: 200, cwd: tempDir,
				parentWorkflowRunId: workflowRunId, workflowKey: "memory", sessionFile,
				steps: [{ agent: "worker", status: "failed", sessionFile, error: "429 rate limit" }],
			}), "utf-8");
			writeRecoveryDescriptor(childDir, childRunId);
			const { executor } = makeExecutor();

			const revived = await executor.execute("revive-workflow-child", { action: "resume", id: childRunId, message: "Retry after the rate limit." }, new AbortController().signal, undefined, makeMinimalCtx(tempDir));
			assert.equal(revived.isError, undefined, revived.content[0]?.text);
			const revivedId = revived.details?.asyncId;
			assert.ok(revivedId, "expected revived async id");
			cleanup.push(path.join(ASYNC_DIR, revivedId), path.join(RESULTS_DIR, `${revivedId}.json`));
			await waitForFile(path.join(RESULTS_DIR, `${revivedId}.json`));
			const revivedStatusPath = path.join(ASYNC_DIR, revivedId, "status.json");
			await waitForStatus(revivedStatusPath, (candidate) => candidate.state === "complete");

			const status = await executor.execute("workflow-status", { action: "status", id: workflowRunId }, new AbortController().signal, undefined, makeMinimalCtx(tempDir));
			assert.match(status.content[0]?.text ?? "", new RegExp(`Child run: ${childRunId}\\n {2}Revived → ${revivedId}: completed`));

			mockPi.onCall({ output: "follow-up summary" });
			const continued = await executor.execute(
				"continue-workflow-key",
				{ async: false, workflowScript: `return runs.run("memory-followup", { resume: { workflowRunId: ${JSON.stringify(workflowRunId)}, key: "memory", latest: true }, task: "Summarize the report.", output: false });` },
				new AbortController().signal,
				undefined,
				makeMinimalCtx(tempDir),
			);
			assert.equal(continued.isError, undefined, continued.content[0]?.text);
			const child = continued.details!.workflow!.value as { runId: string; continuation: { runIds: string[] } };
			cleanup.push(path.join(ASYNC_DIR, child.runId), path.join(RESULTS_DIR, `${child.runId}.json`));
			assert.deepEqual(child.continuation.runIds, [childRunId, revivedId, child.runId]);

			const revivedStatus = JSON.parse(fs.readFileSync(revivedStatusPath, "utf-8"));
			fs.writeFileSync(revivedStatusPath, JSON.stringify({ ...revivedStatus, state: "running", endedAt: undefined }), "utf-8");
			const runningStatus = await executor.execute("workflow-status-running", { action: "status", id: workflowRunId }, new AbortController().signal, undefined, makeMinimalCtx(tempDir));
			assert.match(runningStatus.content[0]?.text ?? "", new RegExp(`Revived → ${revivedId}: running`));
		} finally {
			for (const target of cleanup) fs.rmSync(target, { recursive: true, force: true });
		}
	});

	it("resume action runs retained children in a managed worktree when requested", async () => {
		execFileSync("git", ["init"], { cwd: tempDir, stdio: "ignore" });
		execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: tempDir });
		execFileSync("git", ["config", "user.name", "Test User"], { cwd: tempDir });
		fs.writeFileSync(path.join(tempDir, "base.txt"), "base\n", "utf-8");
		execFileSync("git", ["add", "base.txt"], { cwd: tempDir });
		execFileSync("git", ["commit", "-m", "base"], { cwd: tempDir, stdio: "ignore" });
		mockPi.onCall({ output: "revived isolated answer", writeFiles: [{ path: "feature.txt", content: "feature\n" }] });
		const runId = `resume-worktree-${Date.now()}`;
		const asyncDir = path.join(ASYNC_DIR, runId);
		const sessionFile = path.join(homeDir, `${runId}.jsonl`);
		let revivedId: string | undefined;
		try {
			fs.mkdirSync(asyncDir, { recursive: true });
			fs.writeFileSync(sessionFile, "", "utf-8");
			fs.writeFileSync(path.join(asyncDir, "status.json"), JSON.stringify({
				runId,
				sessionId: "session-123",
				mode: "single",
				state: "complete",
				startedAt: 100,
				lastUpdate: 200,
				cwd: tempDir,
				sessionFile,
				steps: [{ agent: "worker", status: "complete", sessionFile }],
			}, null, 2), "utf-8");
			writeRecoveryDescriptor(asyncDir, runId, "worker", { sessionFile });
			const { executor } = makeExecutor();

			const result = await executor.execute(
				"resume-worktree",
				{ action: "resume", id: runId, message: "Continue in isolation.", worktree: true },
				new AbortController().signal,
				undefined,
				makeMinimalCtx(tempDir),
			);

			assert.equal(result.isError, undefined, result.content[0]?.text ?? "resume failed");
			revivedId = result.details?.asyncId;
			assert.ok(revivedId);
			const resultPath = path.join(RESULTS_DIR, `${revivedId}.json`);
			await waitForFile(resultPath);
			const status = await waitForStatus(path.join(ASYNC_DIR, revivedId, "status.json"), (candidate) => candidate.state === "complete");
			assert.equal(fs.existsSync(path.join(tempDir, "feature.txt")), false);
			assert.equal(status.parallelHandoff?.changedPatches, 1);
			const handoff = JSON.parse(fs.readFileSync(status.parallelHandoff!.path!, "utf-8")) as { groups?: Array<{ children?: Array<{ patch?: { changed?: boolean; filesChanged?: number } }> }> };
			assert.equal(handoff.groups?.[0]?.children?.[0]?.patch?.changed, true);
			assert.equal(handoff.groups?.[0]?.children?.[0]?.patch?.filesChanged, 1);
		} finally {
			fs.rmSync(asyncDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
			if (revivedId) fs.rmSync(path.join(ASYNC_DIR, revivedId), { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
			if (revivedId) fs.rmSync(path.join(RESULTS_DIR, `${revivedId}.json`), { force: true });
			fs.rmSync(sessionFile, { force: true });
		}
	});

	it("revives a removed agent with its persisted bridge override", async () => {
		mockPi.onCall({ output: "descriptor-backed answer" });
		const runId = `resume-descriptor-${Date.now()}`;
		const asyncDir = path.join(ASYNC_DIR, runId);
		const sessionFile = path.join(tempDir, "descriptor-child.jsonl");
		let revivedId: string | undefined;
		try {
			fs.mkdirSync(asyncDir, { recursive: true });
			fs.writeFileSync(sessionFile, "", "utf-8");
			fs.writeFileSync(path.join(asyncDir, "status.json"), JSON.stringify({
				runId, sessionId: "session-123", mode: "single", state: "paused", startedAt: 100, lastUpdate: 200, cwd: tempDir,
				steps: [{ agent: "removed-worker", status: "paused", sessionFile }],
			}, null, 2), "utf-8");
			writeRecoveryDescriptor(asyncDir, runId, "removed-worker", {
				model: "anthropic/claude-sonnet-4:high",
				tools: ["read"],
				systemPrompt: "Original persisted prompt",
				intercomBridge: { mode: "off" },
				maxSubagentDepth: 1,
			});
			const { executor } = makeExecutor({ agents: [] });

			const result = await executor.execute(
				"resume-descriptor",
				{ action: "resume", id: runId, message: "Continue safely." },
				new AbortController().signal,
				undefined,
				makeMinimalCtx(tempDir),
			);

			assert.equal(result.isError, undefined);
			revivedId = result.details.asyncId;
			assert.ok(revivedId);
			const args = await readMockCallArgs(0);
			assert.equal(args[args.indexOf("--session") + 1], sessionFile);
			assert.equal(args[args.indexOf("--model") + 1], "anthropic/claude-sonnet-4:high");
			assert.equal(args[args.indexOf("--tools") + 1], "read");
			assert.equal(args.includes("--system-prompt"), true);
			assert.equal(args.includes("--append-system-prompt"), false);
			await waitForFile(path.join(RESULTS_DIR, `${revivedId}.json`));
		} finally {
			fs.rmSync(asyncDir, { recursive: true, force: true });
		}
	});

	it("rejects concurrent direct revival of the same completed async session and releases ownership", async () => {
		const releasePath = path.join(tempDir, "release-async-revival");
		mockPi.onCall({ waitForPath: releasePath, output: "first revived answer" });
		mockPi.onCall({ output: "answer after release" });
		const sourceRunId = `resume-lease-async-${Date.now()}`;
		const sourceAsyncDir = path.join(ASYNC_DIR, sourceRunId);
		const sessionFile = path.join(tempDir, "leased-async-child.jsonl");
		fs.mkdirSync(sourceAsyncDir, { recursive: true });
		fs.writeFileSync(sessionFile, "", "utf-8");
		fs.writeFileSync(path.join(sourceAsyncDir, "status.json"), JSON.stringify({
			runId: sourceRunId,
			sessionId: "session-123",
			mode: "single",
			state: "complete",
			startedAt: 100,
			lastUpdate: 200,
			cwd: tempDir,
			sessionFile,
			steps: [{ agent: "worker", status: "complete" }],
		}, null, 2), "utf-8");
		writeRecoveryDescriptor(sourceAsyncDir, sourceRunId);
		try {
			const { executor } = makeExecutor();
			const first = await executor.execute(
				"resume-lease-async-first",
				{ action: "resume", id: sourceRunId, message: "First follow-up" },
				new AbortController().signal,
				undefined,
				makeMinimalCtx(tempDir),
			);
			assert.equal(first.isError, undefined);
			const firstRevivedId = first.details?.asyncId;
			assert.ok(firstRevivedId);
			await readMockCallArgs(0);

			const blocked = await executor.execute(
				"resume-lease-async-blocked",
				{ action: "resume", id: sourceRunId, message: "Conflicting follow-up" },
				new AbortController().signal,
				undefined,
				makeMinimalCtx(tempDir),
			);
			assert.equal(blocked.isError, true);
			assert.match(blocked.content[0]?.text ?? "", new RegExp(`already owned by run '${firstRevivedId}'`));
			assert.equal(fs.readdirSync(mockPi.dir).filter((name) => name.startsWith("call-")).length, 1, "contending revival must not spawn Pi");

			fs.writeFileSync(releasePath, "release", "utf-8");
			await waitForFile(path.join(RESULTS_DIR, `${firstRevivedId}.json`));
			await waitForMissingPath(sessionLeaseDir(sessionFile));
			const afterRelease = await executor.execute(
				"resume-lease-async-after-release",
				{ action: "resume", id: sourceRunId, message: "Follow-up after release" },
				new AbortController().signal,
				undefined,
				makeMinimalCtx(tempDir),
			);
			assert.equal(afterRelease.isError, undefined);
			assert.ok(afterRelease.details?.asyncId);
			await waitForFile(path.join(RESULTS_DIR, `${afterRelease.details.asyncId}.json`));
		} finally {
			fs.writeFileSync(releasePath, "release", "utf-8");
			fs.rmSync(sourceAsyncDir, { recursive: true, force: true });
		}
	});

	it("marks a resumed workflow child async when its runner starts and fails before proceed", async () => {
		const parentSessionId = `session-workflow-resume-start-${Date.now()}`;
		const sourceRunId = `workflow-resume-start-source-${Date.now()}`;
		const sourceAsyncDir = path.join(ASYNC_DIR, sourceRunId);
		const sessionFile = path.join(tempDir, "workflow-resume-start-session.jsonl");
		let workflowRunId: string | undefined;
		let revivedRunId: string | undefined;
		try {
			fs.mkdirSync(sourceAsyncDir, { recursive: true });
			fs.writeFileSync(sessionFile, "", "utf-8");
			fs.writeFileSync(path.join(sourceAsyncDir, "status.json"), JSON.stringify({
				runId: sourceRunId,
				sessionId: parentSessionId,
				mode: "single",
				state: "complete",
				startedAt: 100,
				lastUpdate: 200,
				cwd: tempDir,
				sessionFile,
				steps: [{ agent: "worker", status: "complete", sessionFile }],
			}, null, 2), "utf-8");
			writeRecoveryDescriptor(sourceAsyncDir, sourceRunId);
			const competingLease = acquireSessionLease({ sessionFile, runId: "workflow-competing-revival", sourceRunId, parentSessionId });
			const { executor } = makeExecutor({ maxActiveAsyncRunsPerSession: 1 });
			const ctx = makeMinimalCtx(tempDir);
			ctx.sessionManager.getSessionId = () => parentSessionId;
			try {
				const failed = await executor.execute(
					"workflow-resume-start-failure",
					{ workflowScript: `return await runs.run("resume-child", { resume: "${sourceRunId}", task: "Continue", lane: { version: 1, key: "resume-child", mode: "mutation", sourceRef: "owner/repo#1621", claims: ["retained.txt"] } });`, async: true },
					new AbortController().signal,
					undefined,
					ctx,
				);
				workflowRunId = failed.details?.asyncId;
				assert.ok(workflowRunId, "expected async workflow id");
				await waitForFile(path.join(RESULTS_DIR, `${workflowRunId}.json`));
				const workflowStatusPath = path.join(ASYNC_DIR, workflowRunId, "status.json");
				const workflowStatus = await waitForStatus(workflowStatusPath, (value) => value?.state === "failed") as { steps?: Array<{ async?: boolean; runId?: string; lane?: unknown }>; error?: string };
				revivedRunId = workflowStatus.steps?.[0]?.runId;

				assert.equal(workflowStatus.steps?.[0]?.async, true);
				assert.ok(revivedRunId, "expected the workflow step to keep revived run identity");
				assert.deepEqual(workflowStatus.steps?.[0]?.lane, { version: 1, key: "resume-child", mode: "mutation", sourceRef: "owner/repo#1621", claims: ["retained.txt"] });
				assert.match(workflowStatus.error ?? "", /already owned by run 'workflow-competing-revival'/);
				assert.deepEqual(getActiveAsyncCapacitySnapshot(parentSessionId, 1), { used: 0, limit: 1 });
			} finally {
				competingLease.release();
			}
		} finally {
			fs.rmSync(sourceAsyncDir, { recursive: true, force: true });
			if (workflowRunId) fs.rmSync(path.join(ASYNC_DIR, workflowRunId), { recursive: true, force: true });
			if (revivedRunId) fs.rmSync(path.join(ASYNC_DIR, revivedRunId), { recursive: true, force: true });
			fs.rmSync(path.join(ACTIVE_ASYNC_CAPACITY_DIR, activeAsyncCapacitySessionKey(parentSessionId)), { recursive: true, force: true });
		}
	});

	it("releases async workflow capacity after child launch preparation fails", async () => {
		const parentSessionId = `session-workflow-prep-${Date.now()}`;
		try {
			const { executor } = makeExecutor({ maxActiveAsyncRunsPerSession: 1 });
			const ctx = makeMinimalCtx(tempDir);
			ctx.sessionManager.getSessionId = () => parentSessionId;
			const failed = await executor.execute(
				"workflow-prep-capacity-release",
				{
					workflowScript: `return await runs.run("gated", { agent: "worker", task: "run", gate: "npm test" });`,
					async: true,
					acceptance: "checked",
				},
				new AbortController().signal,
				undefined,
				ctx,
			);
			const workflowRunId = failed.details?.asyncId;
			assert.ok(workflowRunId, "expected async workflow id");
			await waitForFile(path.join(RESULTS_DIR, `${workflowRunId}.json`));
			const statusPath = path.join(ASYNC_DIR, workflowRunId, "status.json");
			const status = await waitForStatus(statusPath, (value) => value?.state === "failed") as { state?: string; steps?: Array<{ async?: boolean }>; error?: string };

			assert.equal(status.state, "failed");
			assert.equal(status.steps?.[0]?.async, false);
			assert.match(status.error ?? "", /gate cannot be combined with acceptance/);
			assert.deepEqual(getActiveAsyncCapacitySnapshot(parentSessionId, 1), { used: 0, limit: 1 });

			const next = await executor.execute(
				"workflow-prep-capacity-next",
				{ workflowScript: `return "ok";`, async: true },
				new AbortController().signal,
				undefined,
				ctx,
			);
			assert.equal(next.isError, undefined);
			const nextWorkflowRunId = next.details?.asyncId;
			assert.ok(nextWorkflowRunId, "expected the next async workflow to acquire capacity");
			await waitForFile(path.join(RESULTS_DIR, `${nextWorkflowRunId}.json`));
		} finally {
			fs.rmSync(path.join(ACTIVE_ASYNC_CAPACITY_DIR, activeAsyncCapacitySessionKey(parentSessionId)), { recursive: true, force: true });
		}
	});

	it("restores active capacity when revival fails before startup proceed", async () => {
		const parentSessionId = `session-resume-handshake-${Date.now()}`;
		const sourceRunId = `resume-handshake-source-${Date.now()}`;
		const sourceAsyncDir = path.join(ASYNC_DIR, sourceRunId);
		const sessionFile = path.join(tempDir, "resume-handshake-child.jsonl");
		fs.mkdirSync(sourceAsyncDir, { recursive: true });
		fs.writeFileSync(sessionFile, "", "utf-8");
		fs.writeFileSync(path.join(sourceAsyncDir, "status.json"), JSON.stringify({
			runId: sourceRunId,
			sessionId: parentSessionId,
			mode: "single",
			state: "complete",
			startedAt: 100,
			lastUpdate: 200,
			cwd: tempDir,
			sessionFile,
			steps: [{ agent: "worker", status: "complete", sessionFile }],
		}, null, 2), "utf-8");
		writeRecoveryDescriptor(sourceAsyncDir, sourceRunId);
		const sourceCapacity = acquireActiveAsyncCapacity({ sessionId: parentSessionId, limit: 1, runId: sourceRunId, kind: "runner", asyncDir: sourceAsyncDir });
		assert.ok(sourceCapacity);
		sourceCapacity.markStarted("source-runner");
		fs.writeFileSync(path.join(sourceAsyncDir, "process-terminal.json"), JSON.stringify({
			version: 1,
			state: "observed",
			runId: sourceRunId,
			runnerProcessInstanceId: "source-runner",
			observedAt: Date.now(),
			instances: [{ kind: "runner", processInstanceId: "source-runner", closeObservedAt: Date.now(), exitCode: 0, signal: null }],
		}), "utf-8");
		const competingLease = acquireSessionLease({ sessionFile, runId: "competing-revival", sourceRunId, parentSessionId });
		try {
			const { executor } = makeExecutor({ maxActiveAsyncRunsPerSession: 1 });
			const ctx = makeMinimalCtx(tempDir);
			ctx.sessionManager.getSessionId = () => parentSessionId;
			const failed = await executor.execute(
				"resume-handshake-failure",
				{ action: "resume", id: sourceRunId, message: "Retry safely" },
				new AbortController().signal,
				undefined,
				ctx,
			);
			assert.equal(failed.isError, true);
			assert.match(failed.content[0]?.text ?? "", /already owned by run 'competing-revival'/);
			const revivedStatusDirs = fs.readdirSync(ASYNC_DIR)
				.map((name) => path.join(ASYNC_DIR, name))
				.filter((dir) => {
					try {
						const status = JSON.parse(fs.readFileSync(path.join(dir, "status.json"), "utf-8"));
						return status.sessionId === parentSessionId && status.runId !== sourceRunId && status.processTerminal?.runnerProcessInstanceId;
					} catch {
						return false;
					}
				});
			assert.equal(revivedStatusDirs.length, 1, "expected one failed revived run with runner identity");
			fs.rmSync(path.join(revivedStatusDirs[0]!, "process-terminal.json"), { force: true });
			assert.deepEqual(getActiveAsyncCapacitySnapshot(parentSessionId, 1), { used: 0, limit: 1 });
		} finally {
			competingLease.release();
			getActiveAsyncCapacitySnapshot(parentSessionId, 1);
			fs.rmSync(sourceAsyncDir, { recursive: true, force: true });
		}
	});



	it("applies the same exclusive lease to remembered foreground revival", async () => {
		const releasePath = path.join(tempDir, "release-foreground-revival");
		mockPi.onCall({ output: "original foreground answer" });
		mockPi.onCall({ waitForPath: releasePath, output: "first foreground revival" });
		mockPi.onCall({ output: "foreground revival after release" });
		const { executor } = makeExecutor({ bridgeMode: "off" });
		try {
			const original = await executor.execute(
				"foreground-lease-original",
				{ agent: "worker", task: "Original task" },
				new AbortController().signal,
				undefined,
				makeMinimalCtx(tempDir),
			);
			const sourceRunId = original.details?.runId;
			const sessionFile = original.details?.results?.[0]?.sessionFile;
			assert.ok(sourceRunId);
			assert.ok(sessionFile);

			const first = await executor.execute(
				"foreground-lease-first",
				{ action: "resume", id: sourceRunId, message: "First follow-up" },
				new AbortController().signal,
				undefined,
				makeMinimalCtx(tempDir),
			);
			assert.equal(first.isError, undefined);
			const firstRevivedId = first.details?.asyncId;
			assert.ok(firstRevivedId);

			const blocked = await executor.execute(
				"foreground-lease-blocked",
				{ action: "resume", id: sourceRunId, message: "Conflicting follow-up" },
				new AbortController().signal,
				undefined,
				makeMinimalCtx(tempDir),
			);
			assert.equal(blocked.isError, true);
			assert.match(blocked.content[0]?.text ?? "", new RegExp(`already owned by run '${firstRevivedId}'`));
			// The original and the first revival each spawn Pi asynchronously, so wait for both markers
			// before asserting the contending revival added no third spawn.
			await waitForCallCount(2);
			assert.equal(mockPi.callCount(), 2, "contending foreground revival must not spawn Pi");

			fs.writeFileSync(releasePath, "release", "utf-8");
			await waitForFile(path.join(RESULTS_DIR, `${firstRevivedId}.json`));
			await waitForMissingPath(sessionLeaseDir(sessionFile));
			const afterRelease = await executor.execute(
				"foreground-lease-after-release",
				{ action: "resume", id: sourceRunId, message: "Follow-up after release" },
				new AbortController().signal,
				undefined,
				makeMinimalCtx(tempDir),
			);
			assert.equal(afterRelease.isError, undefined);
			assert.ok(afterRelease.details?.asyncId);
			await waitForFile(path.join(RESULTS_DIR, `${afterRelease.details.asyncId}.json`));
		} finally {
			fs.writeFileSync(releasePath, "release", "utf-8");
		}
	});

	it("status recovers remembered detached foreground output after child exit", async () => {
		mockPi.onCall({
			steps: [
				{ jsonl: [events.toolStart("contact_supervisor", { reason: "need_decision", message: "Need a decision" })] },
				{ delay: 50, jsonl: [events.assistantMessage("final recovered answer")] },
			],
		});
		const { executor, events: bus } = makeExecutor({ agents: [makeAgent("a", { systemPrompt: "Intercom orchestration channel:" })] });
		let detachEmitted = false;
		const original = await executor.execute(
			"foreground-detached-status-original",
			{ agent: "a", task: "ask supervisor" },
			new AbortController().signal,
			(update: { details?: { progress?: Array<{ currentTool?: string }> } }) => {
				if (detachEmitted) return;
				if (!update.details?.progress?.some((entry) => entry.currentTool === "contact_supervisor")) return;
				detachEmitted = true;
				bus.emit(INTERCOM_DETACH_REQUEST_EVENT, { requestId: "single-detached-status" });
			},
			makeMinimalCtx(tempDir),
		);
		assert.equal(detachEmitted, true);
		const runId = original.details?.runId;
		assert.ok(runId, "expected foreground run id");
		assert.match(original.content[0]?.text ?? "", /Detached for intercom coordination/);

		const deadline = Date.now() + 5000;
		let statusText = "";
		while (Date.now() < deadline) {
			const status = await executor.execute(
				"foreground-detached-status",
				{ action: "status", id: runId },
				new AbortController().signal,
				undefined,
				makeMinimalCtx(tempDir),
			);
			statusText = status.content[0]?.text ?? "";
			if (/final recovered answer/.test(statusText)) break;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}

		assert.doesNotMatch(statusText, /Async run not found/);
		assert.match(statusText, /State: remembered foreground/);
		assert.match(statusText, /a: ask supervisor completed/);
		assert.match(statusText, /final recovered answer/);

		const transcript = await executor.execute(
			"foreground-detached-transcript",
			{ action: "status", id: runId, view: "transcript" },
			new AbortController().signal,
			undefined,
			makeMinimalCtx(tempDir),
		);
		const transcriptText = transcript.content[0]?.text ?? "";
		assert.doesNotMatch(transcriptText, /Async run not found/);
		assert.match(transcriptText, /final recovered answer/);
	});

	it("keeps detached acceptance pending and emits recovered foreground completion to the originating session", async () => {
		const acceptanceReport = [
			"final recovered answer",
			"```acceptance-report",
			JSON.stringify({
				criteriaSatisfied: [{ id: "criterion-1", status: "satisfied", evidence: "review completed" }],
				changedFiles: ["src/review.ts"],
				testsAddedOrUpdated: ["test/review.test.ts"],
				commandsRun: [{ command: "npm test", result: "passed", summary: "passed" }],
				validationOutput: ["npm test passed"],
				residualRisks: [],
				noStagedFiles: true,
			}),
			"```",
		].join("\n");
		mockPi.onCall({
			steps: [
				{ jsonl: [events.toolStart("contact_supervisor", { reason: "need_decision", message: "Need a decision" })] },
				{ delay: 75, jsonl: [events.assistantMessage(acceptanceReport)] },
			],
		});
		const { executor, events: bus, state } = makeExecutor({ agents: [makeAgent("a", { systemPrompt: "Intercom orchestration channel:" })] });
		let detachEmitted = false;
		const original = await executor.execute(
			"foreground-detached-completion-original",
			{ agent: "a", task: "ask supervisor", acceptance: { level: "checked", criteria: ["Review completed"] } },
			new AbortController().signal,
			(update: { details?: { progress?: Array<{ currentTool?: string }> } }) => {
				if (detachEmitted || !update.details?.progress?.some((entry) => entry.currentTool === "contact_supervisor")) return;
				detachEmitted = true;
				bus.emit(INTERCOM_DETACH_REQUEST_EVENT, { requestId: "single-detached-completion" });
			},
			makeMinimalCtx(tempDir),
		);
		const runId = original.details?.runId;
		assert.ok(runId, "expected foreground run id");
		assert.equal(original.details?.results?.[0]?.acceptance?.status, "pending");
		assert.match(original.content[0]?.text ?? "", /bg_wait\(\{ id:/);
		const metadataPath = original.details?.results?.[0]?.artifactPaths?.metadataPath;
		assert.ok(metadataPath);
		const pendingMetadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8")) as { acceptance?: { status?: string } };
		assert.equal(pendingMetadata.acceptance?.status, "pending");

		const waited = await waitForSubagents({ id: runId, timeoutMs: 5000 }, undefined, {
			state: state as never,
			events: bus,
			asyncDirRoot: path.join(tempDir, "async-runs"),
			resultsDir: path.join(tempDir, "results"),
		});
		assert.equal(waited.isError, undefined);
		assert.match(waited.content[0]?.text ?? "", /remembered detached foreground run/);

		const completion = bus.emitted.find((event) => event.channel === SUBAGENT_FOREGROUND_COMPLETE_EVENT);
		assert.ok(completion, "expected a foreground completion event");
		const payload = completion.payload as {
			runId?: string;
			sessionId?: string;
			source?: string;
			summary?: string;
			success?: boolean;
		};
		assert.equal(payload.runId, runId);
		assert.equal(payload.sessionId, "session-123");
		assert.equal(payload.source, "foreground");
		assert.equal(payload.success, true);
		assert.match(payload.summary ?? "", /final recovered answer/);
		const recoveredMetadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8")) as { exitCode?: number; acceptance?: { status?: string; childReport?: unknown } };
		assert.equal(recoveredMetadata.exitCode, 0);
		assert.equal(recoveredMetadata.acceptance?.status, "checked");
		assert.ok(recoveredMetadata.acceptance?.childReport);

		const status = await executor.execute(
			"foreground-detached-completion-status",
			{ action: "status", id: runId },
			new AbortController().signal,
			undefined,
			makeMinimalCtx(tempDir),
		);
		assert.match(status.content[0]?.text ?? "", /acceptance: checked/);
	});

	it("preserves deferred acceptance failure details in foreground completion and status", async () => {
		const rejectedReport = [
			"final answer with rejected acceptance evidence",
			"```acceptance-report",
			JSON.stringify({
				criteriaSatisfied: [{ id: "criterion-1", status: "not-satisfied", evidence: "review found a blocker" }],
				changedFiles: ["src/review.ts"],
				testsAddedOrUpdated: ["test/review.test.ts"],
				commandsRun: [{ command: "npm test", result: "failed", summary: "blocker remains" }],
				validationOutput: ["blocker remains"],
				residualRisks: ["review blocker"],
				noStagedFiles: true,
			}),
			"```",
		].join("\n");
		mockPi.onCall({
			steps: [
				{ jsonl: [events.toolStart("contact_supervisor", { reason: "need_decision", message: "Need a decision" })] },
				{ delay: 75, jsonl: [events.assistantMessage(rejectedReport)] },
			],
		});
		const { executor, events: bus, state } = makeExecutor({ agents: [makeAgent("a", { systemPrompt: "Intercom orchestration channel:" })] });
		let detachEmitted = false;
		const original = await executor.execute(
			"foreground-detached-failed-acceptance",
			{ agent: "a", task: "ask supervisor", acceptance: { level: "checked", criteria: ["Review completed"] } },
			new AbortController().signal,
			(update: { details?: { progress?: Array<{ currentTool?: string }> } }) => {
				if (detachEmitted || !update.details?.progress?.some((entry) => entry.currentTool === "contact_supervisor")) return;
				detachEmitted = true;
				bus.emit(INTERCOM_DETACH_REQUEST_EVENT, { requestId: "single-detached-failed-acceptance" });
			},
			makeMinimalCtx(tempDir),
		);
		const runId = original.details?.runId;
		assert.ok(runId);
		assert.equal(original.details?.results?.[0]?.acceptance?.status, "pending");

		const waited = await waitForSubagents({ id: runId, timeoutMs: 5000 }, undefined, {
			state: state as never,
			events: bus,
			asyncDirRoot: path.join(tempDir, "async-runs"),
			resultsDir: path.join(tempDir, "results"),
		});
		assert.equal(waited.isError, undefined);
		assert.match(waited.content[0]?.text ?? "", /1 failed/);

		const completion = bus.emitted.find((event) => event.channel === SUBAGENT_FOREGROUND_COMPLETE_EVENT);
		assert.ok(completion);
		const payload = completion.payload as { success?: boolean; summary?: string };
		assert.equal(payload.success, false);
		assert.match(payload.summary ?? "", /Acceptance rejected/);
		assert.match(payload.summary ?? "", /final answer with rejected acceptance evidence/);

		const status = await executor.execute(
			"foreground-detached-failed-status",
			{ action: "status", id: runId },
			new AbortController().signal,
			undefined,
			makeMinimalCtx(tempDir),
		);
		assert.match(status.content[0]?.text ?? "", /acceptance: rejected/);
		assert.match(status.content[0]?.text ?? "", /error: Acceptance rejected/);
	});





	it("blocks sibling resume while any remembered foreground child remains detached", async () => {
		const { executor, state } = makeExecutor({ bridgeMode: "off", agents: [makeAgent("a"), makeAgent("b")] });
		const siblingSession = path.join(tempDir, "completed-sibling.jsonl");
		fs.writeFileSync(siblingSession, "", "utf-8");
		state.foregroundRuns.set("mixed-detached-run", {
			runId: "mixed-detached-run",
			mode: "parallel",
			cwd: tempDir,
			sessionId: "session-123",
			updatedAt: Date.now(),
			children: [
				{ agent: "a", index: 0, status: "detached", updatedAt: Date.now() },
				{ agent: "b", index: 1, status: "completed", sessionFile: siblingSession, updatedAt: Date.now() },
			],
		});

		const status = await executor.execute(
			"mixed-detached-status",
			{ action: "status", id: "mixed-detached-run" },
			new AbortController().signal,
			undefined,
			makeMinimalCtx(tempDir),
		);
		const statusText = status.content[0]?.text ?? "";
		assert.match(statusText, /do not resume or launch a replacement while any child remains detached/);
		assert.doesNotMatch(statusText, /Revive child:/);

		const resumed = await executor.execute(
			"mixed-detached-resume",
			{ action: "resume", id: "mixed-detached-run", index: 1, message: "replace sibling" },
			new AbortController().signal,
			undefined,
			makeMinimalCtx(tempDir),
		);
		assert.equal(resumed.isError, true);
		assert.match(resumed.content[0]?.text ?? "", /cannot be revived safely while any child may still be live/);
		assert.match(resumed.content[0]?.text ?? "", /do not launch a replacement/);
	});

	it("resume action rejects detached foreground children that may still be live", async () => {
		mockPi.onCall({
			steps: [
				{ jsonl: [events.toolStart("contact_supervisor", { reason: "need_decision", message: "Need a decision" })] },
				{ delay: 1000, jsonl: [events.assistantMessage("after reply")] },
			],
		});
		const { executor, events: bus } = makeExecutor({ agents: [makeAgent("a", { systemPrompt: "Intercom orchestration channel:" })] });
		let detachEmitted = false;
		const original = await executor.execute(
			"foreground-detached-original",
			{ agent: "a", task: "ask supervisor" },
			new AbortController().signal,
			(update: { details?: { progress?: Array<{ currentTool?: string }> } }) => {
				if (detachEmitted) return;
				if (!update.details?.progress?.some((entry) => entry.currentTool === "contact_supervisor")) return;
				detachEmitted = true;
				bus.emit(INTERCOM_DETACH_REQUEST_EVENT, { requestId: "single-detached" });
			},
			makeMinimalCtx(tempDir),
		);
		assert.equal(detachEmitted, true);
		const runId = original.details?.runId;
		assert.ok(runId, "expected foreground run id");

		const fleet = await executor.execute(
			"foreground-detached-fleet",
			{ action: "status", view: "fleet" },
			new AbortController().signal,
			undefined,
			makeMinimalCtx(tempDir),
		);
		const fleetText = fleet.content[0]?.text ?? "";
		assert.match(fleetText, /Foreground runs:/);
		assert.ok(fleetText.includes(runId));
		assert.match(fleetText, /running/);
		assert.match(fleetText, /contact_supervisor/);

		const resumed = await executor.execute(
			"foreground-detached-resume",
			{ action: "resume", id: runId, message: "Follow up" },
			new AbortController().signal,
			undefined,
			makeMinimalCtx(tempDir),
		);

		assert.equal(resumed.isError, true);
		assert.match(resumed.content[0]?.text ?? "", /detached for intercom coordination/);
		assert.match(resumed.content[0]?.text ?? "", /Reply to the supervisor request first/);
		assert.doesNotMatch(resumed.content[0]?.text ?? "", /revive only/);
	});

	it("does not inspect or resume remembered foreground runs from another parent session", async () => {
		const { executor, state } = makeExecutor({ bridgeMode: "off", agents: [makeAgent("a")] });
		const sessionFile = path.join(tempDir, "other-session-child.jsonl");
		fs.writeFileSync(sessionFile, "", "utf-8");
		state.foregroundRuns.set("other-session-run", {
			runId: "other-session-run",
			mode: "single",
			cwd: tempDir,
			sessionId: "session-other",
			updatedAt: Date.now(),
			children: [{ agent: "a", index: 0, status: "completed", sessionFile }],
		});

		const status = await executor.execute(
			"other-session-status",
			{ action: "status", id: "other-session-run" },
			new AbortController().signal,
			undefined,
			makeMinimalCtx(tempDir),
		);
		assert.equal(status.isError, true);
		assert.doesNotMatch(status.content[0]?.text ?? "", /State: remembered foreground/);

		const fleet = await executor.execute(
			"other-session-fleet",
			{ action: "status", view: "fleet" },
			new AbortController().signal,
			undefined,
			makeMinimalCtx(tempDir),
		);
		assert.doesNotMatch(fleet.content[0]?.text ?? "", /other-session-run/);

		const resumed = await executor.execute(
			"other-session-resume",
			{ action: "resume", id: "other-session-run", message: "Follow up" },
			new AbortController().signal,
			undefined,
			makeMinimalCtx(tempDir),
		);
		assert.equal(resumed.isError, true);
		assert.doesNotMatch(resumed.content[0]?.text ?? "", /Revived foreground subagent/);
		assert.equal(mockPi.callCount(), 0);
	});

	it("resume action keeps exact foreground validation errors over async prefix matches", async () => {
		const base = `exact-invalid-${Date.now()}`;
		const asyncSession = path.join(tempDir, "async-exact-prefix.jsonl");
		fs.writeFileSync(asyncSession, "", "utf-8");
		const asyncDir = path.join(ASYNC_DIR, `${base}-async`);
		try {
			fs.mkdirSync(asyncDir, { recursive: true });
			fs.writeFileSync(path.join(asyncDir, "status.json"), JSON.stringify({
				runId: `${base}-async`,
				mode: "single",
				state: "complete",
				startedAt: 100,
				lastUpdate: 200,
				cwd: tempDir,
				steps: [{ agent: "a", status: "complete", sessionFile: asyncSession }],
			}, null, 2), "utf-8");
			const { executor, state } = makeExecutor({ bridgeMode: "off", agents: [makeAgent("a")] });
			state.foregroundRuns.set(base, {
				runId: base,
				mode: "single",
				cwd: tempDir,
				sessionId: "session-123",
				updatedAt: Date.now(),
				children: [{ agent: "a", index: 0, status: "completed" }],
			});

			const result = await executor.execute(
				"resume-exact-invalid-foreground",
				{ action: "resume", id: base, message: "Follow up" },
				new AbortController().signal,
				undefined,
				makeMinimalCtx(tempDir),
			);

			assert.equal(result.isError, true);
			assert.match(result.content[0]?.text ?? "", /Foreground run '.+' child 0 does not have a persisted session file/);
			assert.equal(mockPi.callCount(), 0);
		} finally {
			fs.rmSync(asyncDir, { recursive: true, force: true });
		}
	});

	it("resume action keeps exact async validation errors over foreground prefix matches", async () => {
		const base = `exact-invalid-async-${Date.now()}`;
		const foregroundSession = path.join(tempDir, "foreground-exact-prefix.jsonl");
		fs.writeFileSync(foregroundSession, "", "utf-8");
		const asyncDir = path.join(ASYNC_DIR, base);
		try {
			fs.mkdirSync(asyncDir, { recursive: true });
			fs.writeFileSync(path.join(asyncDir, "status.json"), JSON.stringify({
				runId: base,
				sessionId: "session-123",
				mode: "single",
				state: "complete",
				startedAt: 100,
				lastUpdate: 200,
				cwd: tempDir,
				steps: [{ agent: "a", status: "complete" }],
			}, null, 2), "utf-8");
			const { executor, state } = makeExecutor({ bridgeMode: "off", agents: [makeAgent("a")] });
			state.foregroundRuns.set(`${base}-foreground`, {
				runId: `${base}-foreground`,
				mode: "single",
				cwd: tempDir,
				sessionId: "session-123",
				updatedAt: Date.now(),
				children: [{ agent: "a", index: 0, status: "completed", sessionFile: foregroundSession }],
			});

			const result = await executor.execute(
				"resume-exact-invalid-async",
				{ action: "resume", id: base, message: "Follow up" },
				new AbortController().signal,
				undefined,
				makeMinimalCtx(tempDir),
			);

			assert.equal(result.isError, true);
			assert.match(result.content[0]?.text ?? "", /Async run '.+' child 0 does not have a persisted session file/);
			assert.equal(mockPi.callCount(), 0);
		} finally {
			fs.rmSync(asyncDir, { recursive: true, force: true });
		}
	});

	it("resume action reports async ambiguity even when foreground has one prefix match", async () => {
		const base = `namespace-ambiguous-${Date.now()}`;
		const foregroundSession = path.join(tempDir, "foreground-prefix.jsonl");
		const firstAsyncSession = path.join(tempDir, "async-a.jsonl");
		const secondAsyncSession = path.join(tempDir, "async-b.jsonl");
		fs.writeFileSync(foregroundSession, "", "utf-8");
		fs.writeFileSync(firstAsyncSession, "", "utf-8");
		fs.writeFileSync(secondAsyncSession, "", "utf-8");
		const firstAsyncDir = path.join(ASYNC_DIR, `${base}-async-a`);
		const secondAsyncDir = path.join(ASYNC_DIR, `${base}-async-b`);
		try {
			for (const [asyncDir, runId, sessionFile] of [[firstAsyncDir, `${base}-async-a`, firstAsyncSession], [secondAsyncDir, `${base}-async-b`, secondAsyncSession]] as const) {
				fs.mkdirSync(asyncDir, { recursive: true });
				fs.writeFileSync(path.join(asyncDir, "status.json"), JSON.stringify({
					runId,
					sessionId: "session-123",
					mode: "single",
					state: "complete",
					startedAt: 100,
					lastUpdate: 200,
					cwd: tempDir,
					steps: [{ agent: "a", status: "complete", sessionFile }],
				}, null, 2), "utf-8");
			}
			const { executor, state } = makeExecutor({ bridgeMode: "off", agents: [makeAgent("a")] });
			state.foregroundRuns.set(`${base}-foreground`, {
				runId: `${base}-foreground`,
				mode: "single",
				cwd: tempDir,
				sessionId: "session-123",
				updatedAt: Date.now(),
				children: [{ agent: "a", index: 0, status: "completed", sessionFile: foregroundSession }],
			});

			const result = await executor.execute(
				"ambiguous-async-prefix-resume",
				{ action: "resume", id: base, message: "Follow up" },
				new AbortController().signal,
				undefined,
				makeMinimalCtx(tempDir),
			);

			assert.equal(result.isError, true);
			assert.match(result.content[0]?.text ?? "", /Ambiguous subagent run id prefix/);
		} finally {
			fs.rmSync(firstAsyncDir, { recursive: true, force: true });
			fs.rmSync(secondAsyncDir, { recursive: true, force: true });
		}
	});

	it("resume action reports ambiguous ids across remembered foreground and async runs", async () => {
		const base = `ambiguous-${Date.now()}`;
		const foregroundSession = path.join(tempDir, "foreground.jsonl");
		const asyncSession = path.join(tempDir, "async.jsonl");
		const asyncId = `${base}-async`;
		const foregroundId = `${base}-foreground`;
		const asyncDir = path.join(ASYNC_DIR, asyncId);
		fs.writeFileSync(foregroundSession, "", "utf-8");
		fs.writeFileSync(asyncSession, "", "utf-8");
		try {
			fs.mkdirSync(asyncDir, { recursive: true });
			fs.writeFileSync(path.join(asyncDir, "status.json"), JSON.stringify({
				runId: asyncId,
				sessionId: "session-123",
				mode: "single",
				state: "complete",
				startedAt: 100,
				lastUpdate: 200,
				cwd: tempDir,
				steps: [{ agent: "a", status: "complete", sessionFile: asyncSession }],
			}, null, 2), "utf-8");
			const { executor, state } = makeExecutor({ bridgeMode: "off", agents: [makeAgent("a")] });
			state.foregroundRuns.set(foregroundId, {
				runId: foregroundId,
				mode: "single",
				cwd: tempDir,
				sessionId: "session-123",
				updatedAt: Date.now(),
				children: [{ agent: "a", index: 0, status: "completed", sessionFile: foregroundSession }],
			});

			const result = await executor.execute(
				"ambiguous-resume",
				{ action: "resume", id: base, message: "Follow up" },
				new AbortController().signal,
				undefined,
				makeMinimalCtx(tempDir),
			);

			assert.equal(result.isError, true);
			assert.match(result.content[0]?.text ?? "", /ambiguous between foreground run/);
		} finally {
			fs.rmSync(asyncDir, { recursive: true, force: true });
		}
	});



	it("does not treat a synthetic foreground startup error as child output", async () => {
		mockPi.onCall({ output: "", stderr: "mock startup failure", exitCode: 1 });
		const { executor } = makeExecutor({ agents: [makeAgent("worker")] });

		const result = await executor.execute(
			"foreground-synthetic-error",
			{ agent: "worker", task: "synthetic-error-task" },
			new AbortController().signal,
			undefined,
			makeMinimalCtx(tempDir),
		);

		assert.equal(result.isError, true);
		assert.equal(result.details?.results?.[0]?.outputState, "absent");
	});
});
