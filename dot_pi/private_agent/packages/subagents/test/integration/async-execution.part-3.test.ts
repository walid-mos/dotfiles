/**
 * Integration tests for async (background) agent execution.
 *
 * Tests the async support utilities: jiti availability check,
 * status file reading/caching.
 *
 * Requires pi packages to be importable. Skips gracefully if unavailable.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { ChildProcess } from "node:child_process";
import { channel } from "node:diagnostics_channel";
import { pathToFileURL } from "node:url";
import { childSessionFactoryModule, setChildSessionFactoryModule } from "../../src/runs/shared/child-session.ts";
import { createEventBus, createTempDir, events, makeAgent, makeMinimalCtx, removeTempDir } from "../support/helpers.ts";
import { discoverAgents } from "../../src/agents/agents.ts";
import { ACTIVE_ASYNC_CAPACITY_DIR, acquireActiveAsyncCapacity, activeAsyncCapacitySessionKey, getActiveAsyncCapacitySnapshot } from "../../src/runs/background/active-async-capacity.ts";
import { readActiveRunIndex } from "../../src/runs/background/active-run-index.ts";
import { deriveForkPromptCacheKey } from "../../src/runs/shared/child-tool-plan.ts";
import { INVALID_STRUCTURED_OUTPUT_SCHEMA_ERROR, validateStructuredOutputValue } from "../../src/runs/shared/structured-output.ts";
import type { ChildRuntimeConfig } from "../../src/runs/shared/child-runtime-config.ts";
import type { AsyncExecutionResult, AsyncResultPayload, AsyncStatusPayload } from "../support/async-execution-fixture.ts";
import {
	installAsyncExecutionHooks, waitForMockPiRuntime, available, isAsyncAvailable,
	executeAsyncSingle, ASYNC_DIR, RESULTS_DIR, TEMP_ROOT_DIR,
	createSubagentExecutor, escapeRegExp, writePackageSkill,
	waitForAsyncResultFile, waitForAsyncState, waitForMockPiCall,
	readLastMockPiArgs, readMockPiArgs, readMockPiArgsMatching, tempDir, mockPi,
	makeAsyncExecutor, readAsyncPayload,
} from "../support/async-execution-fixture.ts";

const WATCH_TIMEOUT_MS = 30_000;

// A runner that never starts or never settles must fail this test by name, not stall the whole CI step.
function watchTimeoutMessage(what: string, asyncDir: string, extra?: () => string): string {
	const read = (name: string) => {
		try { return fs.readFileSync(path.join(asyncDir, name), "utf8").slice(-2000); } catch (error) { return `<${(error as NodeJS.ErrnoException).code ?? "unreadable"}>`; }
	};
	let details = "";
	if (extra) {
		try { details = `\n${extra()}`; } catch (error) { details = `\n<diagnostics failed: ${String(error)}>`; }
	}
	return `Timed out after ${WATCH_TIMEOUT_MS}ms waiting for ${what}\nstatus.json: ${read("status.json")}\nrunner.stderr.log: ${read("runner.stderr.log")}${details}`;
}

function waitForPath(file: string, asyncDir: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			fs.unwatchFile(file, inspect);
			reject(new Error(watchTimeoutMessage(file, asyncDir)));
		}, WATCH_TIMEOUT_MS);
		const inspect = () => {
			if (!fs.existsSync(file)) return;
			clearTimeout(timer);
			fs.unwatchFile(file, inspect);
			resolve();
		};
		fs.watchFile(file, { interval: 20 }, inspect);
		inspect();
	});
}

function waitForJson<T>(file: string, predicate: (value: T) => boolean, asyncDir: string, extra?: () => string): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			fs.unwatchFile(file, inspect);
			reject(new Error(watchTimeoutMessage(`a matching ${file}`, asyncDir, extra)));
		}, WATCH_TIMEOUT_MS);
		const inspect = () => {
			try {
				const value = JSON.parse(fs.readFileSync(file, "utf8")) as T;
				if (!predicate(value)) return;
				clearTimeout(timer);
				fs.unwatchFile(file, inspect);
				resolve(value);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
				clearTimeout(timer);
				fs.unwatchFile(file, inspect);
				reject(error);
			}
		};
		fs.watchFile(file, { interval: 20 }, inspect);
		inspect();
	});
}

describe("async execution utilities", { skip: !available ? "pi packages not available" : undefined }, () => {
	installAsyncExecutionHooks();

	it("background does not use compaction recovery after compaction_end willRetry false and a continued agent turn", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		const sessionFile = path.join(tempDir, "async-generic-empty-after-successful-compaction-session.jsonl");
		mockPi.onCall({
			jsonl: [
				{ type: "compaction_start" },
				{ type: "compaction_end", willRetry: false },
				{ type: "agent_start" },
				{
					type: "message_end",
					message: {
						role: "assistant",
						content: [],
						model: "openai/gpt-5-mini",
						stopReason: "aborted",
						usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
					},
				},
				{ type: "agent_settled" },
			],
			writeFiles: [{ path: sessionFile, content: "{}\n" }],
			exitCode: 0,
		});
		mockPi.onCall({ output: "Compaction recovery must not run" });
		const id = `async-no-compaction-recovery-after-successful-compaction-${Date.now().toString(36)}`;
		executeAsyncSingle(id, {
			agent: "worker",
			task: "Do work",
			sessionFile,
			agentConfig: makeAgent("worker", { model: "openai/gpt-5-mini" }),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			availableModels: [{ provider: "openai", id: "gpt-5-mini", fullId: "openai/gpt-5-mini" }],
			artifactConfig: {
				enabled: false,
				includeInput: false,
				includeOutput: false,
				includeJsonl: false,
				includeMetadata: false,
				cleanupDays: 7,
			},
			maxSubagentDepth: 2,
		});

		const payload = JSON.parse(fs.readFileSync(await waitForAsyncResultFile(id), "utf-8"));
		assert.equal(payload.success, false);
		assert.match(payload.results[0]?.error ?? "", /Subagent produced no output after terminal assistant stopReason "aborted"\./u);
		assert.equal(mockPi.callCount(), 1);
	});

	it("background fails a zero-exit child that stops during a tool after earlier assistant output", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({
			jsonl: [
				events.assistantMessage("Work is in progress"),
				events.toolStart("bash", { command: "write files" }),
			],
			exitCode: 0,
		});
		const id = `async-mid-tool-exit-${Date.now().toString(36)}`;
		executeAsyncSingle(id, {
			agent: "worker",
			task: "Do work",
			agentConfig: makeAgent("worker", { model: "openai/gpt-5-mini" }),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: {
				enabled: false,
				includeInput: false,
				includeOutput: false,
				includeJsonl: false,
				includeMetadata: false,
				cleanupDays: 7,
			},
			maxSubagentDepth: 2,
		});

		const resultPath = await waitForAsyncResultFile(id);
		const payload = JSON.parse(fs.readFileSync(resultPath, "utf-8")) as AsyncResultPayload;
		assert.equal(payload.success, false);
		assert.equal(payload.results[0]?.success, false);
		assert.match(payload.results[0]?.error ?? "", /ended during 'bash' tool execution before the tool completed/);
		assert.match(payload.results[0]?.error ?? "", /Earlier assistant output is not a terminal result/);
		assert.doesNotMatch(payload.results[0]?.error ?? "", /cold-start/);
		assert.equal(mockPi.callCount(), 1);
	});

	it("background retains an earlier open tool when a later overlapping tool completes", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({
			jsonl: [
				{ type: "tool_execution_start", toolCallId: "bash-1", toolName: "bash", args: { command: "wait" } },
				{ type: "tool_execution_start", toolCallId: "read-1", toolName: "read", args: { path: "README.md" } },
				{ type: "tool_execution_end", toolCallId: "read-1", toolName: "read" },
			],
			exitCode: 0,
		});
		const id = `async-overlap-mid-tool-exit-${Date.now().toString(36)}`;
		executeAsyncSingle(id, {
			agent: "worker",
			task: "Do work",
			agentConfig: makeAgent("worker", { model: "openai/gpt-5-mini" }),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
			maxSubagentDepth: 2,
		});

		const resultPath = await waitForAsyncResultFile(id);
		const payload = JSON.parse(fs.readFileSync(resultPath, "utf-8")) as AsyncResultPayload;
		assert.equal(payload.success, false);
		assert.match(payload.results[0]?.error ?? "", /ended during 'bash' tool execution before the tool completed/);
	});

	for (const terminal of [
		{ name: "empty text stop", content: [{ type: "text", text: "" }], stopReason: "stop", error: /no output.*empty response/i },
		{ name: "tool-call-only stop", content: [{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "README.md" } }], stopReason: "toolUse", error: /grep failed.*Path not found/i },
		{ name: "empty text length limit", content: [{ type: "text", text: "" }], stopReason: "length", error: /grep failed.*Path not found/i },
	]) {
		it(`background diagnoses ${terminal.name} after an exploratory tool error`, { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
			mockPi.onCall({
				stdoutRaw: [
					events.toolResult("grep", "Path not found", true),
					events.toolResult("read", "recovered file contents"),
					{
						type: "message_end",
						message: {
							role: "assistant",
							content: terminal.content,
							model: "openai/gpt-5-mini",
							stopReason: terminal.stopReason,
							usage: { input: 0, output: 4, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
						},
					},
				].map((event) => JSON.stringify(event)).join("\n"),
				exitCode: 0,
			});
			const id = `async-terminal-diagnosis-${Date.now().toString(36)}`;
			executeAsyncSingle(id, {
				agent: "worker",
				task: "Do work",
				agentConfig: makeAgent("worker", { model: "openai/gpt-5-mini" }),
				ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
				artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
				maxSubagentDepth: 2,
			});

			const resultPath = await waitForAsyncResultFile(id);
			const payload = JSON.parse(fs.readFileSync(resultPath, "utf-8")) as AsyncResultPayload;
			assert.equal(payload.success, false);
			assert.equal(payload.exitCode, 1);
			assert.match(payload.results[0]?.error ?? "", terminal.error);
			assert.equal(payload.results[0]?.output, "");
			const status = await waitForAsyncState(id, (candidate) => candidate.state === "failed");
			assert.match(status.steps?.[0]?.error ?? "", terminal.error);
		});
	}

	it("background runs treat recovered child errors as successful", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({
			jsonl: [
				events.toolResult("read", "EISDIR: illegal operation on a directory", true),
				{
					type: "message_end",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "temporary provider failure" }],
						model: "openai/gpt-5-mini",
						stopReason: "error",
						errorMessage: "provider transport failed",
						usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: { total: 0.01 } },
					},
				},
				events.assistantMessage("Recovered asynchronously"),
			],
		});
		const id = `async-recovered-child-error-${Date.now().toString(36)}`;
		const asyncDir = path.join(ASYNC_DIR, id);
		executeAsyncSingle(id, {
			agent: "worker",
			task: "Do work",
			agentConfig: makeAgent("worker", { model: "openai/gpt-5-mini" }),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: {
				enabled: false,
				includeInput: false,
				includeOutput: false,
				includeJsonl: false,
				includeMetadata: false,
				cleanupDays: 7,
			},
			maxSubagentDepth: 2,
		});

		const resultPath = await waitForAsyncResultFile(id);
		const payload = JSON.parse(fs.readFileSync(resultPath, "utf-8")) as AsyncResultPayload;
		assert.equal(payload.success, true);
		assert.equal(payload.state, "complete");
		assert.equal(payload.exitCode, 0);
		assert.equal(payload.results[0]?.success, true);
		assert.equal(payload.results[0]?.error, undefined);
		assert.equal(payload.results[0]?.output, "Recovered asynchronously");
		const statusPayload = await waitForAsyncState(id, (candidate) => candidate.state === "complete");
		assert.equal(statusPayload.state, "complete");
		assert.equal(statusPayload.steps?.[0]?.status, "complete");
		assert.equal(statusPayload.steps?.[0]?.exitCode, 0);
	});

	it("background runs keep provider errors failed when followed only by empty assistant output", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({
			jsonl: [
				{
					type: "message_end",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "temporary provider failure" }],
						model: "openai/gpt-5-mini",
						stopReason: "error",
						errorMessage: "provider transport failed",
						usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: { total: 0.01 } },
					},
				},
				events.assistantMessage(""),
			],
		});
		const id = `async-provider-error-empty-stop-${Date.now().toString(36)}`;
		const asyncDir = path.join(ASYNC_DIR, id);
		executeAsyncSingle(id, {
			agent: "worker",
			task: "Do work",
			agentConfig: makeAgent("worker", { model: "openai/gpt-5-mini" }),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: {
				enabled: false,
				includeInput: false,
				includeOutput: false,
				includeJsonl: false,
				includeMetadata: false,
				cleanupDays: 7,
			},
			maxSubagentDepth: 2,
		});

		const resultPath = await waitForAsyncResultFile(id);
		const payload = JSON.parse(fs.readFileSync(resultPath, "utf-8")) as AsyncResultPayload;
		assert.equal(payload.success, false);
		assert.equal(payload.state, "failed");
		assert.equal(payload.exitCode, 1);
		assert.equal(payload.results[0]?.success, false);
		assert.match(payload.results[0]?.error ?? "", /provider transport failed/);
		assert.equal(payload.results[0]?.output, "");
		const statusPayload = await waitForAsyncState(id, (candidate) => candidate.state === "failed");
		assert.equal(statusPayload.state, "failed");
		assert.equal(statusPayload.steps?.[0]?.status, "failed");
		assert.equal(statusPayload.steps?.[0]?.exitCode, 1);
	});

	it("background file-only runs write full output but return only a file reference", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({ output: "async full output\nwith details" });
		const id = `async-file-only-${Date.now().toString(36)}`;
		const resultPath = path.join(RESULTS_DIR, `${id}.json`);
		const outputPath = path.join(tempDir, "async-file-only.md");
		const run = executeAsyncSingle(id, {
			agent: "analyst",
			task: "Analyze without modifying files",
			agentConfig: makeAgent("analyst", { tools: ["read", "grep", "find", "ls"] }),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: {
				enabled: false,
				includeInput: false,
				includeOutput: false,
				includeJsonl: false,
				includeMetadata: false,
				cleanupDays: 7,
			},
			sessionRoot: path.join(tempDir, "sessions"),
			output: outputPath,
			outputMode: "file-only",
			maxSubagentDepth: 2,
		});

		assert.equal(run.details.asyncId, id);
		const call = await waitForMockPiCall(mockPi, 0);
		const taskArg = call.args.at(-1) ?? "";
		const systemPrompt = call.systemPrompts[0]?.text ?? "";
		for (const instruction of [taskArg, systemPrompt]) {
			assert.match(instruction, /Return the complete artifact in your final response\./);
			assert.match(instruction, /runtime will persist it to exactly this path:/);
			assert.match(instruction, /Do not call contact_supervisor merely because no write-capable tool is available\./);
			assert.doesNotMatch(instruction, /Write your findings to exactly this path/);
		}
		const deadline = Date.now() + 10_000;
		while (!fs.existsSync(resultPath)) {
			if (Date.now() > deadline) assert.fail(`Timed out waiting for async result file: ${resultPath}`);
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		const payload = JSON.parse(fs.readFileSync(resultPath, "utf-8")) as AsyncResultPayload;
		assert.equal(payload.success, true);
		assert.match(payload.summary ?? "", /Output saved to:/);
		assert.match(payload.summary ?? "", /2 lines/);
		assert.doesNotMatch(payload.summary ?? "", /async full output/);
		assert.match(payload.results[0]?.output ?? "", /Output saved to:/);
		assert.doesNotMatch(payload.results[0]?.output ?? "", /async full output/);
		assert.equal(fs.readFileSync(outputPath, "utf-8"), "async full output\nwith details");
	});

	it("removes Pi turn-timing telemetry from runtime-persisted background output", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		const report = "## Review\n\nVERDICT: FINDINGS";
		const timingFooter = "\x1b[38;2;136;136;136m✻ Turn took 5m 54s (Total time 5m 54s · 2 turns)\x1b[0m";
		mockPi.onCall({ output: `${report}\n\n${timingFooter}` });
		const id = `async-timing-footer-${Date.now().toString(36)}`;
		const outputPath = path.join(tempDir, "async-review.md");
		executeAsyncSingle(id, {
			agent: "reviewer",
			task: "Review without modifying files",
			agentConfig: makeAgent("reviewer", { tools: ["read", "grep", "find", "ls"] }),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: {
				enabled: false,
				includeInput: false,
				includeOutput: false,
				includeJsonl: false,
				includeMetadata: false,
				cleanupDays: 7,
			},
			sessionRoot: path.join(tempDir, "sessions"),
			output: outputPath,
			acceptance: false,
			maxSubagentDepth: 2,
		});

		const resultPath = await waitForAsyncResultFile(id);
		const payload = JSON.parse(fs.readFileSync(resultPath, "utf-8")) as AsyncResultPayload;
		assert.equal(payload.success, true);
		assert.equal(fs.readFileSync(outputPath, "utf-8"), report);
		assert.doesNotMatch(payload.summary ?? "", /Turn took/);
		assert.doesNotMatch(payload.results[0]?.output ?? "", /Turn took/);
	});

	it("background single runs route relative outputs to outputBaseDir", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({ output: "async configured report" });
		const id = `async-configured-output-base-${Date.now().toString(36)}`;
		const outputBaseDir = path.join(tempDir, "async-configured-outputs");
		const run = executeAsyncSingle(id, {
			agent: "researcher",
			task: "Write report",
			agentConfig: makeAgent("researcher", { output: "context.md" }),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: {
				enabled: false,
				includeInput: false,
				includeOutput: false,
				includeJsonl: false,
				includeMetadata: false,
				cleanupDays: 7,
			},
			sessionRoot: path.join(tempDir, "sessions"),
			output: "context.md",
			outputBaseDir,
			maxSubagentDepth: 2,
		});

		assert.equal(run.details.asyncId, id);
		const outputPath = path.join(outputBaseDir, "context.md");
		const call = await waitForMockPiCall(mockPi, 0);
		const taskArg = call.args.at(-1) ?? "";
		assert.match(taskArg, new RegExp(`Write your findings to exactly this path: ${escapeRegExp(outputPath)}`));
		const resultPath = await waitForAsyncResultFile(id);
		const payload = JSON.parse(fs.readFileSync(resultPath, "utf-8")) as AsyncResultPayload;
		assert.equal(payload.success, true);
		assert.equal(fs.readFileSync(outputPath, "utf-8"), "async configured report");
		assert.equal(fs.existsSync(path.join(tempDir, "context.md")), false);
	});

	it("background single runs make output overrides authoritative in the child system prompt", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({ output: "async override report" });
		const id = `async-output-override-system-prompt-${Date.now().toString(36)}`;
		const outputPath = path.join(tempDir, "async-custom-report.md");
		const run = executeAsyncSingle(id, {
			agent: "researcher",
			task: "Write report",
			agentConfig: makeAgent("researcher", {
				output: "default-report.md",
				systemPrompt: "Output format (`default-report.md`):\n\nWrite the full report to default-report.md.",
			}),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: {
				enabled: false,
				includeInput: false,
				includeOutput: false,
				includeJsonl: false,
				includeMetadata: false,
				cleanupDays: 7,
			},
			sessionRoot: path.join(tempDir, "sessions"),
			output: outputPath,
			maxSubagentDepth: 2,
		});

		assert.equal(run.details.asyncId, id);
		const call = await waitForMockPiCall(mockPi, 0);
		const taskArg = call.args.at(-1) ?? "";
		const systemPrompt = call.systemPrompts[0]?.text ?? "";
		assert.match(taskArg, new RegExp(`Write your findings to exactly this path: ${escapeRegExp(outputPath)}`));
		assert.match(systemPrompt, /Output format \(`default-report\.md`\):/);
		assert.match(systemPrompt, /Runtime output path override:/);
		assert.match(systemPrompt, new RegExp(`Write your findings to exactly this path: ${escapeRegExp(outputPath)}`));
		assert.match(systemPrompt, /Ignore any other output filename or output path mentioned elsewhere/);
		await waitForAsyncResultFile(id);
	});

	it("background single runs treat string false as disabled output", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({ output: "async inline report" });
		const id = `async-string-false-output-${Date.now().toString(36)}`;
		const run = executeAsyncSingle(id, {
			agent: "worker",
			task: "Do work",
			agentConfig: makeAgent("worker", { output: "default-report.md" }),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: {
				enabled: false,
				includeInput: false,
				includeOutput: false,
				includeJsonl: false,
				includeMetadata: false,
				cleanupDays: 7,
			},
			sessionRoot: path.join(tempDir, "sessions"),
			output: "false",
			maxSubagentDepth: 2,
		});

		assert.equal(run.details.asyncId, id);
		const resultPath = await waitForAsyncResultFile(id);
		const payload = JSON.parse(fs.readFileSync(resultPath, "utf-8")) as AsyncResultPayload;
		assert.equal(payload.success, true);
		assert.equal(payload.results[0]?.output, "async inline report");
		assert.doesNotMatch(payload.summary ?? "", /Output saved to:/);
		assert.equal(fs.existsSync(path.join(tempDir, "false")), false);
		assert.equal(fs.existsSync(path.join(tempDir, "default-report.md")), false);
		assert.doesNotMatch(readLastMockPiArgs(mockPi).at(-1) ?? "", /Write your findings to(?: exactly this path)?:/);
	});

	it("background runs detect hidden tool failures even when the child exits 0", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({
			jsonl: [events.toolResult("bash", "connection refused")],
		});

		const id = `async-hidden-failure-${Date.now().toString(36)}`;
		const resultPath = path.join(RESULTS_DIR, `${id}.json`);
		const sessionRoot = path.join(tempDir, "sessions");

		executeAsyncSingle(id, {
			agent: "worker",
			task: "Deploy app",
			agentConfig: makeAgent("worker"),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: {
				enabled: false,
				includeInput: false,
				includeOutput: false,
				includeJsonl: false,
				includeMetadata: false,
				cleanupDays: 7,
			},
			sessionRoot,
			maxSubagentDepth: 2,
		});

		const deadline = Date.now() + 10_000;
		while (!fs.existsSync(resultPath)) {
			if (Date.now() > deadline) {
				assert.fail(`Timed out waiting for async result file: ${resultPath}`);
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		const payload = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
		assert.equal(payload.success, false);
		assert.equal(payload.exitCode, 1);
		assert.equal(payload.results[0].success, false);
	});


	it("background no-edit runs complete regardless of implementation wording and mutation capability", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({ output: "No workspace change was needed; tool-name data: write edit bash replace." });

		const id = `async-no-mutation-${Date.now().toString(36)}`;
		const resultPath = path.join(RESULTS_DIR, `${id}.json`);
		const sessionRoot = path.join(tempDir, "sessions");

		executeAsyncSingle(id, {
			agent: "worker",
			task: "Implement and write the approved fixes using the available mutation tools",
			agentConfig: makeAgent("worker", { tools: ["read", "write", "bash"], mutationTools: ["replace"] }),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: {
				enabled: false,
				includeInput: false,
				includeOutput: false,
				includeJsonl: false,
				includeMetadata: false,
				cleanupDays: 7,
			},
			sessionRoot,
			maxSubagentDepth: 2,
		});

		const deadline = Date.now() + 10_000;
		while (!fs.existsSync(resultPath)) {
			if (Date.now() > deadline) {
				assert.fail(`Timed out waiting for async result file: ${resultPath}`);
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		const payload = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
		assert.equal(payload.success, true, JSON.stringify(payload));
		assert.equal(payload.exitCode, 0);
		assert.equal(payload.results[0].success, true);
		assert.equal(payload.results[0].effects?.fileMutation, undefined);
	});

	it("agent contract keeps async acceptance and file-mutation effects separate from execution", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({ output: "I’ll do that now and report back after implementing.\n```acceptance-report\n{\"criteriaSatisfied\":[{\"id\":\"criterion-1\",\"status\":\"not-satisfied\",\"evidence\":\"no proof\"}]}\n```" });
		const id = `async-v1-separate-${Date.now().toString(36)}`;

		executeAsyncSingle(id, {
			agent: "worker",
			task: "Implement the approved fixes",
			agentConfig: makeAgent("worker"),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: {
				enabled: false,
				includeInput: false,
				includeOutput: false,
				includeJsonl: false,
				includeMetadata: false,
				cleanupDays: 7,
			},
			sessionRoot: path.join(tempDir, "sessions"),
			maxSubagentDepth: 2,
			agentContract: { version: 1 },
			acceptance: { level: "checked", criteria: ["Return required proof"] },
		});

		const resultPath = await waitForAsyncResultFile(id, 10_000);
		const payload = JSON.parse(fs.readFileSync(resultPath, "utf-8")) as AsyncResultPayload;
		const statusPayload = await waitForAsyncState(id, (candidate) => candidate.state === "complete");

		assert.equal(payload.success, true);
		assert.equal(payload.state, "complete");
		assert.equal(payload.exitCode, 0);
		assert.equal(payload.results[0]?.agentContract?.version, 1);
		assert.equal(payload.results[0]?.execution?.status, "completed");
		assert.equal(payload.results[0]?.execution?.success, true);
		assert.equal(payload.results[0]?.acceptance?.status, "rejected");
		assert.equal(payload.results[0]?.effects?.fileMutation, undefined);
		assert.equal(statusPayload.state, "complete");
		assert.equal(statusPayload.steps?.[0]?.agentContract?.version, 1);
		assert.equal(statusPayload.steps?.[0]?.execution?.status, "completed");
		assert.equal(statusPayload.steps?.[0]?.effects?.fileMutation, undefined);
	});

	it("background single runs support outputSchema", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		const expectedStructuredOutput = { ok: true, note: "async" };
		mockPi.onCall({ output: "", structuredOutput: expectedStructuredOutput });
		const id = `async-single-schema-${Date.now().toString(36)}`;
		const outputPath = path.join(tempDir, `${id}.json`);

		executeAsyncSingle(id, {
			agent: "worker",
			task: "Return structured data",
			agentConfig: makeAgent("worker"),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: {
				enabled: false,
				includeInput: false,
				includeOutput: false,
				includeJsonl: false,
				includeMetadata: false,
				cleanupDays: 7,
			},
			sessionRoot: path.join(tempDir, "sessions"),
			maxSubagentDepth: 2,
			acceptance: false,
			output: outputPath,
			structuredOutputSchema: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" }, note: { type: "string" } } },
		});

		const payload = JSON.parse(fs.readFileSync(await waitForAsyncResultFile(id, 10_000), "utf-8")) as AsyncResultPayload;
		assert.equal(payload.success, true);
		assert.deepEqual(payload.results[0]?.structuredOutput, expectedStructuredOutput);
		assert.equal(payload.results[0]?.savedOutputPath, outputPath);
		const savedOutput = fs.readFileSync(outputPath, "utf-8");
		assert.equal(savedOutput, JSON.stringify(expectedStructuredOutput, null, 2));
	});

	it("background settlement preserves rejected structured_output evidence", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		const diagnostic = "Structured output validation failed: ok: is required";
		mockPi.onCall({
			jsonl: [
				{ type: "message_end", message: { role: "assistant", content: [{ type: "toolCall", id: "structured-rejected", name: "structured_output", arguments: { value: {} } }], model: "mock/test-model", stopReason: "toolUse", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } } } },
				{ type: "tool_execution_start", toolCallId: "structured-rejected", toolName: "structured_output", args: { value: {} } },
				{ type: "tool_result_end", message: { role: "toolResult", toolCallId: "structured-rejected", toolName: "structured_output", isError: true, content: [{ type: "text", text: diagnostic }] } },
				{ type: "tool_execution_end", toolCallId: "structured-rejected", toolName: "structured_output" },
			],
		});
		const id = `async-single-schema-rejected-${Date.now().toString(36)}`;

		executeAsyncSingle(id, {
			agent: "worker",
			task: "Return structured data",
			agentConfig: makeAgent("worker"),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
			sessionRoot: path.join(tempDir, "sessions"),
			maxSubagentDepth: 2,
			acceptance: false,
			structuredOutputSchema: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } },
		});

		const payload = JSON.parse(fs.readFileSync(await waitForAsyncResultFile(id, 10_000), "utf-8")) as AsyncResultPayload;
		const status = await waitForAsyncState(id, (candidate) => candidate.state === "failed");
		assert.equal(payload.success, false);
		assert.match(payload.results[0]?.error ?? "", /Structured output validation failed: ok: is required/);
		assert.doesNotMatch(payload.results[0]?.error ?? "", /Missing structured_output call/);
		assert.equal(payload.results[0]?.structuredOutputFailed, true);
		assert.match(status.steps?.[0]?.error ?? "", /Structured output validation failed: ok: is required/);
	});

	it("does not persist malformed outputSchema compiler text in background evidence", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		const sentinel = "BACKGROUND_PRIVATE_SCHEMA_SENTINEL";
		const structuredOutputSchema = { type: "string", pattern: `${sentinel}_[invalid` };
		const validation = await validateStructuredOutputValue(structuredOutputSchema, "value");
		assert.equal(validation.status, "invalid");
		if (validation.status !== "invalid") return;
		assert.match(validation.message, new RegExp(sentinel));
		mockPi.onCall({
			jsonl: [
				{ type: "tool_execution_start", toolCallId: "structured-malformed-schema", toolName: "structured_output", args: { value: "value" } },
				{ type: "tool_result_end", message: { role: "toolResult", toolCallId: "structured-malformed-schema", toolName: "structured_output", isError: true, content: [{ type: "text", text: `Structured output validation failed: ${validation.message}` }] } },
				{ type: "tool_execution_end", toolCallId: "structured-malformed-schema", toolName: "structured_output" },
			],
		});
		const id = `async-single-malformed-schema-${Date.now().toString(36)}`;
		executeAsyncSingle(id, {
			agent: "worker", task: "Return structured data", agentConfig: makeAgent("worker"),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
			sessionRoot: path.join(tempDir, "sessions"), maxSubagentDepth: 2,
			acceptance: false, structuredOutputSchema,
		});

		const resultPath = await waitForAsyncResultFile(id, 10_000);
		const payloadText = fs.readFileSync(resultPath, "utf-8");
		const payload = JSON.parse(payloadText) as AsyncResultPayload;
		const status = await waitForAsyncState(id, (candidate) => candidate.state === "failed");
		assert.match(payload.results[0]?.error ?? "", new RegExp(`^${escapeRegExp(INVALID_STRUCTURED_OUTPUT_SCHEMA_ERROR)}`));
		assert.equal(payloadText.includes(sentinel), false);
		assert.equal((status.steps?.[0]?.error ?? "").includes(sentinel), false);
	});

	it("background execution inherits a discovered agent outputSchema", { skip: !isAsyncAvailable() || !createSubagentExecutor ? "jiti or executor not available" : undefined }, async () => {
		const agentDir = path.join(tempDir, ".pi", "agents");
		fs.mkdirSync(agentDir, { recursive: true });
		fs.writeFileSync(path.join(agentDir, "typed.md"), `---\nname: typed\ndescription: Typed output\noutputSchema: {"type":"object","required":["ok"]}\n---\nReturn data.\n`);
		const agents = discoverAgents(tempDir, "project").agents;
		const executor = makeAsyncExecutor(agents);
		const id = `async-schema-default-${Date.now().toString(36)}`;
		mockPi.onCall({ output: "ordinary prose" });
		const launch = await executor.execute(id, { agent: "typed", task: "Return data", async: true, runId: id, acceptance: false, artifacts: false }, new AbortController().signal, undefined, makeMinimalCtx(tempDir)) as AsyncExecutionResult;
		assert.equal(launch.isError, undefined);
		const payload = await readAsyncPayload(launch.details.asyncId!);
		assert.equal(payload.success, false);
		assert.match(payload.results[0]?.error ?? "", /Missing structured_output call/);
	});

	it("workflow acceptance uses inherited schemas and rejects a false opt-out", { skip: !isAsyncAvailable() || !createSubagentExecutor ? "jiti or executor not available" : undefined }, async () => {
		const agentDir = path.join(tempDir, ".pi", "agents");
		fs.mkdirSync(agentDir, { recursive: true });
		fs.writeFileSync(path.join(agentDir, "typed.md"), `---\nname: typed\ndescription: Typed output\noutputSchema: {"type":"object","required":["ok"]}\n---\nReturn data.\n`);
		const executor = makeAsyncExecutor(discoverAgents(tempDir, "project").agents);
		mockPi.onCall({ output: "ordinary prose" });
		const inherited = await executor.execute("workflow-schema-default", {
			async: false,
			workflowScript: `return runs.run("typed", { agent: "typed", task: "Return data", acceptance: { level: "checked", report: "on" } });`,
		}, new AbortController().signal, undefined, makeMinimalCtx(tempDir));
		assert.equal(inherited.isError, true);
		assert.match(inherited.content[0]?.type === "text" ? inherited.content[0].text : "", /Missing structured_output call/);

		const disabled = await executor.execute("workflow-schema-disabled", {
			async: false,
			workflowScript: `return runs.run("typed", { agent: "typed", task: "Return prose", outputSchema: false, acceptance: { level: "checked", report: "on" } });`,
		}, new AbortController().signal, undefined, makeMinimalCtx(tempDir));
		assert.equal(disabled.isError, true);
		assert.match(disabled.content[0]?.type === "text" ? disabled.content[0].text : "", /acceptance\.report requires outputSchema/);

		mockPi.onCall({ output: "missing structured call" });
		mockPi.onCall({ output: "false opted out" });
		const parallel = await executor.execute("workflow-schema-parallel", {
			async: false,
			workflowScript: `const children = await runs.all([
				{ key: "inherited", agent: "typed", task: "Return data", acceptance: false },
				{ key: "disabled", agent: "typed", task: "Return prose", outputSchema: false, acceptance: false }
			]); return children.map(({ key, ok, error, output }) => ({ key, ok, error, output }));`,
		}, new AbortController().signal, undefined, makeMinimalCtx(tempDir));
		assert.equal(parallel.isError, undefined, parallel.content[0]?.type === "text" ? parallel.content[0].text : undefined);
		const children = parallel.details.workflow?.value as Array<{ key: string; ok: boolean; error?: string; output: string }>;
		assert.equal(children.find(({ key }) => key === "inherited")?.ok, false);
		assert.match(children.find(({ key }) => key === "inherited")?.error ?? "", /Missing structured_output call/);
		assert.deepEqual(children.find(({ key }) => key === "disabled"), { key: "disabled", ok: true, output: "false opted out" });
		assert.equal(mockPi.callCount(), 3);
	});

	it("background outputSchema runs fail closed when required acceptanceReport is missing", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({ output: "structured", structuredOutput: { ok: true } });
		const id = `async-schema-missing-acceptance-${Date.now().toString(36)}`;

		executeAsyncSingle(id, {
			agent: "worker",
			task: "Return structured data",
			agentConfig: makeAgent("worker"),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
			sessionRoot: path.join(tempDir, "sessions"),
			maxSubagentDepth: 2,
			acceptance: { level: "checked", report: "on" },
			structuredOutputSchema: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } },
		});

		const payload = JSON.parse(fs.readFileSync(await waitForAsyncResultFile(id, 10_000), "utf-8")) as AsyncResultPayload;
		assert.equal(payload.success, false);
		assert.match(payload.results[0]?.error ?? "", /Missing acceptanceReport/);
		assert.equal(payload.results[0]?.acceptance?.status, "rejected");
	});

	it("background bash-enabled agents can complete without edits", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({ output: "cold start test after patch" });

		const id = `async-no-edit-bash-${Date.now().toString(36)}`;
		const sessionRoot = path.join(tempDir, "sessions");

		executeAsyncSingle(id, {
			agent: "test-runner",
			task: "Run cold start test after patch",
			agentConfig: makeAgent("test-runner", { tools: ["read", "grep", "bash", "ls"] }),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: {
				enabled: false,
				includeInput: false,
				includeOutput: false,
				includeJsonl: false,
				includeMetadata: false,
				cleanupDays: 7,
			},
			sessionRoot,
			maxSubagentDepth: 2,
		});

		const resultPath = await waitForAsyncResultFile(id, 10_000);
		const payload = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
		assert.equal(payload.success, true);
		assert.equal(payload.exitCode, 0);
		assert.equal(payload.results[0].success, true);
		assert.equal(payload.results[0].output, "cold start test after patch");

	});

	it("background runs prefer the parent session provider for ambiguous bare model ids", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({ output: "Done asynchronously" });

		const id = `async-provider-${Date.now().toString(36)}`;
		const resultPath = path.join(RESULTS_DIR, `${id}.json`);
		const sessionRoot = path.join(tempDir, "sessions");

		executeAsyncSingle(id, {
			agent: "worker",
			task: "Do work",
			agentConfig: makeAgent("worker", { model: "gpt-5-mini" }),
			ctx: {
				pi: { events: { emit() {} } },
				cwd: tempDir,
				currentSessionId: "session-1",
				currentModelProvider: "github-copilot",
			},
			availableModels: [
				{ provider: "openai", id: "gpt-5-mini", fullId: "openai/gpt-5-mini" },
				{ provider: "github-copilot", id: "gpt-5-mini", fullId: "github-copilot/gpt-5-mini" },
			],
			artifactConfig: {
				enabled: false,
				includeInput: false,
				includeOutput: false,
				includeJsonl: false,
				includeMetadata: false,
				cleanupDays: 7,
			},
			sessionRoot,
			maxSubagentDepth: 2,
		});

		const deadline = Date.now() + 10_000;
		while (!fs.existsSync(resultPath)) {
			if (Date.now() > deadline) {
				assert.fail(`Timed out waiting for async result file: ${resultPath}`);
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		const payload = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
		assert.equal(payload.success, true);
		assert.equal(payload.results[0].model, "github-copilot/gpt-5-mini");
	});

	it("rejects an over-cap top-level async launch before creating run artifacts", { skip: !isAsyncAvailable() || !createSubagentExecutor ? "jiti or executor not available" : undefined }, async () => {
		fs.rmSync(path.join(ACTIVE_ASYNC_CAPACITY_DIR, activeAsyncCapacitySessionKey("session-cap")), { recursive: true, force: true });
		const state = {
			baseCwd: tempDir,
			currentSessionId: "session-cap",
			asyncJobs: new Map(),
			fleetJobs: new Map(),
			foregroundControls: new Map(),
			lastForegroundControlId: null,
		};
		const occupied = acquireActiveAsyncCapacity({
			sessionId: "session-cap",
			limit: 1,
			runId: "held-run",
			kind: "runner",
			asyncDir: path.join(tempDir, "held-run"),
		});
		assert.ok(occupied);
		occupied.markStarted("held-runner");
		const rejectedAsyncDir = path.join(ASYNC_DIR, "cap-rejected");
		const rejectedResultPath = path.join(RESULTS_DIR, "cap-rejected.json");
		fs.rmSync(rejectedAsyncDir, { recursive: true, force: true });
		fs.rmSync(rejectedResultPath, { force: true });
		const executor = createSubagentExecutor!({
			pi: { events: createEventBus(), getSessionName: () => undefined },
			state,
			config: { maxActiveAsyncRunsPerSession: 1, artifactDir: "project" },
			asyncByDefault: false,
			tempArtifactsDir: tempDir,
			getSubagentSessionRoot: () => path.join(tempDir, "sessions"),
			expandTilde: (p: string) => p,
			discoverAgents: () => ({ agents: [makeAgent("worker")] }),
		});
		const context = makeMinimalCtx(tempDir);
		context.sessionManager.getSessionFile = () => null;
		context.sessionManager.getSessionId = () => "session-cap";
		const previousDepth = process.env.PI_SUBAGENT_DEPTH;
		process.env.PI_SUBAGENT_DEPTH = "0";
		const result = await executor.execute("cap-rejected", { agent: "worker", task: "Must not start", async: true }, new AbortController().signal, undefined, context);
		if (previousDepth === undefined) delete process.env.PI_SUBAGENT_DEPTH;
		else process.env.PI_SUBAGENT_DEPTH = previousDepth;
		assert.equal(result.isError, true);
		assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /Active async run capacity exhausted: 1\/1 used/);
		assert.equal(fs.existsSync(rejectedAsyncDir), false);
		assert.equal(fs.existsSync(rejectedResultPath), false);
		assert.equal(fs.existsSync(path.join(tempDir, ".pi", "subagents")), false);
		fs.rmSync(path.join(ACTIVE_ASYNC_CAPACITY_DIR, activeAsyncCapacitySessionKey("session-cap")), { recursive: true, force: true });
	});

	it("async executor keeps the last parent session model after continuation drops ctx.model", { skip: !isAsyncAvailable() || !createSubagentExecutor ? "jiti or executor not available" : undefined }, async () => {
		mockPi.onCall({ output: "Done asynchronously" });
		const state = {
			baseCwd: tempDir,
			currentSessionId: null,
			asyncJobs: new Map(),
			foregroundControls: new Map(),
			lastForegroundControlId: null,
		};
		const executor = createSubagentExecutor!({
			pi: { events: createEventBus(), getSessionName: () => undefined },
			state,
			config: {},
			asyncByDefault: false,
			tempArtifactsDir: tempDir,
			getSubagentSessionRoot: () => path.join(tempDir, "sessions"),
			expandTilde: (p: string) => p,
			discoverAgents: () => ({ agents: [makeAgent("worker")] }),
		});
		const initialCtx = makeMinimalCtx(tempDir);
		initialCtx.sessionManager.getSessionId = () => "session-continued";
		initialCtx.model = { provider: "deepseek", id: "deepseek-v4-flash" };
		await executor.execute("prime-parent-model", { action: "list" }, new AbortController().signal, undefined, initialCtx);

		const continuedCtx = makeMinimalCtx(tempDir);
		continuedCtx.sessionManager.getSessionId = () => "session-continued";
		const launch = await executor.execute(
			"continued-async-child",
			{ agent: "worker", task: "Do work", async: true, acceptance: false },
			new AbortController().signal,
			undefined,
			continuedCtx,
		) as AsyncExecutionResult;
		assert.equal(launch.isError, undefined);
		assert.ok(launch.details.asyncId);

		const payload = await readAsyncPayload(launch.details.asyncId);
		assert.equal(payload.success, true);
		assert.equal(payload.results[0]?.model, "deepseek/deepseek-v4-flash");
		const args = readMockPiArgs(mockPi, 0);
		assert.equal(args[args.indexOf("--model") + 1], "deepseek/deepseek-v4-flash");
	});

	it("async workflows snapshot the parent model before workflow setup reads session data", { skip: !isAsyncAvailable() || !createSubagentExecutor ? "jiti or executor not available" : undefined }, async () => {
		mockPi.onCall({ output: "Inherited model work" });
		mockPi.onCall({ output: "Explicit model work" });
		const state = {
			baseCwd: tempDir,
			currentSessionId: null,
			asyncJobs: new Map(),
			foregroundControls: new Map(),
			lastForegroundControlId: null,
		};
		const executor = createSubagentExecutor!({
			pi: { events: createEventBus(), getSessionName: () => undefined },
			state,
			config: {},
			asyncByDefault: false,
			tempArtifactsDir: tempDir,
			getSubagentSessionRoot: () => path.join(tempDir, "sessions"),
			expandTilde: (p: string) => p,
			discoverAgents: () => ({ agents: [makeAgent("worker")] }),
		});
		const context = makeMinimalCtx(tempDir);
		context.sessionManager.getSessionId = () => "session-workflow-parent-model";
		context.model = { provider: "router", id: "openai-personal" };
		context.sessionManager.getSessionFile = () => {
			context.model = undefined;
			return null;
		};

		const launch = await executor.execute(
			"workflow-parent-model",
			{ workflowScript: `await runs.run("inherited", { agent: "worker", task: "Do inherited work" }); return runs.run("explicit", { agent: "worker", task: "Do explicit work", model: "openai/gpt-5-mini" });`, async: true },
			new AbortController().signal,
			undefined,
			context,
		) as AsyncExecutionResult;
		assert.equal(launch.isError, undefined);
		assert.ok(launch.details.asyncId);

		const payload = await readAsyncPayload(launch.details.asyncId);
		assert.equal(payload.success, true);
		const inheritedArgs = readMockPiArgsMatching(mockPi, "Do inherited work");
		const explicitArgs = readMockPiArgsMatching(mockPi, "Do explicit work");
		assert.equal(inheritedArgs[inheritedArgs.indexOf("--model") + 1], "router/openai-personal");
		assert.equal(explicitArgs[explicitArgs.indexOf("--model") + 1], "openai/gpt-5-mini");
	});

	it("background single runs inherit the parent session model when no model is set", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({ output: "Done asynchronously" });

		const id = `async-single-parent-model-${Date.now().toString(36)}`;
		executeAsyncSingle(id, {
			agent: "worker",
			task: "Do work",
			agentConfig: makeAgent("worker"),
			ctx: {
				pi: { events: { emit() {} } },
				cwd: tempDir,
				currentSessionId: "session-1",
				currentModelProvider: "deepseek",
				currentModel: { provider: "deepseek", id: "deepseek-v4-flash" },
			},
			artifactConfig: {
				enabled: false,
				includeInput: false,
				includeOutput: false,
				includeJsonl: false,
				includeMetadata: false,
				cleanupDays: 7,
			},
			sessionRoot: path.join(tempDir, "sessions"),
			maxSubagentDepth: 2,
		});

		const resultPath = await waitForAsyncResultFile(id, 10_000);
		const payload = JSON.parse(fs.readFileSync(resultPath, "utf-8")) as AsyncResultPayload;
		assert.equal(payload.success, true);
		assert.equal(payload.results[0].model, "deepseek/deepseek-v4-flash");
		const args = readMockPiArgs(mockPi, 0);
		assert.equal(args[args.indexOf("--model") + 1], "deepseek/deepseek-v4-flash");
	});

	it("revival preserves captured response aliases and their absence after config changes", { skip: !isAsyncAvailable() || !createSubagentExecutor ? "jiti or executor not available" : undefined }, async () => {
		const route = "databricks-bedrock/ias-claude-opus-5";
		const agents = [makeAgent("worker", { model: route })];
		const cases = [
			{ original: { [route]: ["original-echo"] }, current: {}, echo: "original-echo", success: true },
			{ original: { [route]: ["original-echo"] }, current: { [route]: ["new-echo"] }, echo: "new-echo", success: false },
			{ original: undefined, current: { [route]: ["new-echo"] }, echo: "new-echo", success: false },
		];
		for (const [index, scenario] of cases.entries()) {
			const parentSessionFile = path.join(tempDir, `alias-parent-${index}.jsonl`);
			const sessionFile = path.join(tempDir, `alias-child-${index}.jsonl`);
			const header = JSON.stringify({ type: "session", version: 1, id: `alias-${index}`, cwd: fs.realpathSync(tempDir) });
			fs.writeFileSync(parentSessionFile, `${header}\n`);
			fs.writeFileSync(sessionFile, `${header}\n`);
			const ctx = {
				...makeMinimalCtx(tempDir),
				modelRegistry: { getAvailable: () => [{ provider: "databricks-bedrock", id: "ias-claude-opus-5" }] },
				sessionManager: {
					getSessionId: () => `alias-session-${index}`,
					getSessionFile: () => parentSessionFile,
					getLeafId: () => "leaf",
					openSession: () => ({ createBranchedSession: () => sessionFile }),
				},
			};
			mockPi.onCall({ jsonl: [events.assistantMessage("Initial work", route)] });
			const launch = await makeAsyncExecutor(agents, { modelResponseAliases: scenario.original }).execute(
				`alias-launch-${index}`, { agent: "worker", task: "Do work", async: true, context: "fork", acceptance: false },
				new AbortController().signal, undefined, ctx,
			) as AsyncExecutionResult;
			assert.ok(!launch.isError, launch.content[0]?.text);
			assert.ok(launch.details.asyncId);
			assert.equal((await readAsyncPayload(launch.details.asyncId)).success, true);

			// A new executor must recover the durable launch declaration, not its current settings.
			mockPi.onCall({ jsonl: [events.assistantMessage("Continued work", scenario.echo)] });
			const resumed = await makeAsyncExecutor(agents, { modelResponseAliases: scenario.current }).execute(
				`alias-revive-${index}`, { action: "resume", id: launch.details.asyncId, message: "Continue", acceptance: false },
				new AbortController().signal, undefined, ctx,
			) as AsyncExecutionResult;
			assert.ok(!resumed.isError, resumed.content[0]?.text);
			assert.ok(resumed.details.asyncId);
			const payload = await readAsyncPayload(resumed.details.asyncId);
			assert.equal(payload.success, scenario.success, `case ${index}: ${payload.results[0]?.error}`);
			if (!scenario.success) assert.match(payload.results[0]?.error ?? "", /model_verification_failed/);
			const args = readMockPiArgs(mockPi, index * 2 + 1);
			assert.equal(args[args.indexOf("--model") + 1], route);
			assert.equal(args[args.indexOf("--session") + 1], sessionFile);
		}
	});

	it("revives retained agents without treating their descendant allowlist as parent authority", { skip: !isAsyncAvailable() || !createSubagentExecutor ? "jiti or executor not available" : undefined }, async () => {
		const planner = makeAgent("planner", { allowedAgents: ["researcher"] });
		const agents = [planner, makeAgent("researcher")];
		const parentSessionFile = path.join(tempDir, "allowlist-parent.jsonl");
		const plannerSessionFile = path.join(tempDir, "allowlist-planner.jsonl");
		const header = JSON.stringify({ type: "session", version: 1, id: "allowlist", cwd: fs.realpathSync(tempDir) });
		fs.writeFileSync(parentSessionFile, `${header}\n`);
		fs.writeFileSync(plannerSessionFile, `${header}\n`);
		const sessionId = "resume-allowlist-session";
		const ctx = {
			...makeMinimalCtx(tempDir),
			sessionManager: {
				getSessionId: () => sessionId,
				getSessionFile: () => parentSessionFile,
				getLeafId: () => "leaf",
				openSession: () => ({ createBranchedSession: () => plannerSessionFile }),
			},
		};
		const callerRuntime: ChildRuntimeConfig = {
			capabilityCeiling: { version: 1, allowedTools: ["grep", "read"], allowedAgents: ["planner", "researcher"], denyExtensions: false, sources: ["original-parent"] },
		};
		const makeExecutor = () => createSubagentExecutor!({
			pi: { events: createEventBus(), getSessionName: () => undefined },
			state: { baseCwd: tempDir, currentSessionId: sessionId, asyncJobs: new Map(), foregroundControls: new Map(), lastForegroundControlId: null },
			config: {},
			asyncByDefault: false,
			tempArtifactsDir: tempDir,
			getSubagentSessionRoot: () => tempDir,
			expandTilde: (value: string) => value,
			discoverAgents: () => ({ agents }),
			childRuntime: callerRuntime,
		});
		const executor = makeExecutor();
		mockPi.onCall({ output: "Initial planning complete" });
		const launch = await executor.execute(
			"allowlist-launch", { agent: "planner", task: "Plan", async: true, context: "fork", acceptance: false },
			new AbortController().signal, undefined, ctx,
		) as AsyncExecutionResult;
		assert.ok(!launch.isError, launch.content[0]?.text);
		assert.ok(launch.details.asyncId);
		assert.equal((await readAsyncPayload(launch.details.asyncId)).success, true);
		callerRuntime.capabilityCeiling = { version: 1, allowedTools: ["read"], allowedAgents: ["planner", "researcher"], denyExtensions: false, sources: ["current-caller"] };

		let retainedId = launch.details.asyncId;
		for (const [index, output] of ["First continuation complete", "Second continuation complete"].entries()) {
			mockPi.onCall({ output });
			const resumed = await executor.execute(
				`allowlist-resume-${index}`, { action: "resume", id: retainedId, message: "Continue", acceptance: false },
				new AbortController().signal, undefined, ctx,
			) as AsyncExecutionResult;
			assert.ok(!resumed.isError, resumed.content[0]?.text);
			assert.ok(resumed.details.asyncId);
			retainedId = resumed.details.asyncId;
			const payload = await readAsyncPayload(retainedId);
			assert.equal(payload.success, true);
			assert.deepEqual(payload.capabilityCeiling, {
				version: 1,
				allowedTools: ["read"],
				allowedAgents: ["researcher"],
				denyExtensions: false,
				sources: ["agent:planner", "current-caller", "original-parent"],
			});
			const descriptor = JSON.parse(fs.readFileSync(path.join(ASYNC_DIR, retainedId, "recovery-descriptor.json"), "utf-8"));
			assert.deepEqual(descriptor.allowedAgents, ["researcher"]);
			assert.deepEqual(descriptor.capabilityCeiling, {
				version: 1,
				allowedTools: ["read"],
				allowedAgents: ["planner", "researcher"],
				denyExtensions: false,
				sources: ["current-caller", "original-parent"],
			});
		}

		callerRuntime.capabilityCeiling = { version: 1, allowedAgents: ["researcher"], denyExtensions: false, sources: ["restricted-current-caller"] };
		const restrictedExecutor = makeExecutor();
		const rejected = await restrictedExecutor.execute(
			"allowlist-rejected", { action: "resume", id: retainedId, message: "Continue", acceptance: false },
			new AbortController().signal, undefined, ctx,
		) as AsyncExecutionResult;
		assert.equal(rejected.isError, true);
		assert.match(rejected.content[0]?.text ?? "", /does not allow agent 'planner'/);
	});

	it("revives a current workflow child from persisted parent admission authority", { skip: !isAsyncAvailable() || !createSubagentExecutor ? "jiti or executor not available" : undefined }, async () => {
		const agents = [makeAgent("planner", { allowedAgents: ["researcher"] }), makeAgent("researcher")];
		const parentAuthority = { version: 1 as const, allowedAgents: ["planner", "researcher"], denyExtensions: false, sources: ["workflow-parent"] };
		const ctx = makeMinimalCtx(tempDir);
		const executor = createSubagentExecutor!({
			pi: { events: createEventBus(), getSessionName: () => undefined, sendMessage() {} },
			state: { baseCwd: tempDir, currentSessionId: "session-123", asyncJobs: new Map(), foregroundControls: new Map(), lastForegroundControlId: null },
			config: {},
			asyncByDefault: false,
			tempArtifactsDir: tempDir,
			getSubagentSessionRoot: () => tempDir,
			expandTilde: (value: string) => value,
			discoverAgents: () => ({ agents }),
			childRuntime: { capabilityCeiling: parentAuthority },
		});
		mockPi.onCall({ output: "Initial workflow child complete" });
		const launch = await executor.execute(
			"workflow-parent-authority-launch",
			{ workflowScript: `return await runs.run("planner", { agent: "planner", task: "Plan", acceptance: false })`, async: true, mission: false, capabilityCeiling: parentAuthority },
			new AbortController().signal, undefined, ctx,
		) as AsyncExecutionResult;
		assert.ok(!launch.isError, launch.content[0]?.text);
		assert.ok(launch.details.asyncId);
		await readAsyncPayload(launch.details.asyncId);
		const status = JSON.parse(fs.readFileSync(path.join(ASYNC_DIR, launch.details.asyncId, "status.json"), "utf-8"));
		assert.deepEqual(status.admissionCapabilityCeiling, parentAuthority);

		mockPi.onCall({ output: "Workflow child resumed" });
		const resumed = await executor.execute(
			"workflow-parent-authority-resume", { action: "resume", id: launch.details.asyncId, message: "Continue", acceptance: false },
			new AbortController().signal, undefined, ctx,
		) as AsyncExecutionResult;
		assert.ok(!resumed.isError, resumed.content[0]?.text);
		assert.ok(resumed.details.asyncId);
		const payload = await readAsyncPayload(resumed.details.asyncId);
		assert.equal(payload.success, true);
		assert.deepEqual(payload.capabilityCeiling, {
			version: 1,
			allowedAgents: ["researcher"],
			denyExtensions: false,
			sources: ["agent:planner", "workflow-parent"],
		});
	});

	it("fails closed when a retained workflow child lacks original-authority metadata", { skip: !createSubagentExecutor ? "executor not available" : undefined }, async () => {
		const runId = `legacy-workflow-resume-${Date.now().toString(36)}`;
		const asyncDir = path.join(ASYNC_DIR, runId);
		const sessionFile = path.join(tempDir, "legacy-workflow-child.jsonl");
		fs.mkdirSync(asyncDir, { recursive: true });
		fs.writeFileSync(sessionFile, "{}\n");
		fs.writeFileSync(path.join(asyncDir, "status.json"), JSON.stringify({
			runId,
			sessionId: "session-123",
			mode: "workflow",
			state: "complete",
			startedAt: 100,
			lastUpdate: 200,
			cwd: tempDir,
			capabilityCeiling: { version: 1, allowedAgents: ["researcher"], denyExtensions: false, sources: ["agent:planner"] },
			steps: [{ agent: "planner", status: "complete", sessionFile }],
		}));
		try {
			const result = await makeAsyncExecutor([makeAgent("planner", { allowedAgents: ["researcher"] }), makeAgent("researcher")]).execute(
				"legacy-workflow-resume", { action: "resume", id: runId, message: "Continue", acceptance: false },
				new AbortController().signal, undefined, makeMinimalCtx(tempDir),
			) as AsyncExecutionResult;
			assert.equal(result.isError, true);
			assert.match(result.content[0]?.text ?? "", /missing its required run fan-out recovery identity/);
			assert.equal(mockPi.callCount(), 0);
		} finally {
			fs.rmSync(asyncDir, { recursive: true, force: true });
		}
	});

	it("publishes each revival startup control on its distinct public file", { timeout: 40_000, skip: !isAsyncAvailable() || !createSubagentExecutor ? "jiti or executor not available" : undefined }, async () => {
		const agents = [makeAgent("worker")];
		const parentSessionFile = path.join(tempDir, "startup-control-parent.jsonl");
		const sessionFile = path.join(tempDir, "startup-control-child.jsonl");
		const header = JSON.stringify({ type: "session", version: 1, id: "startup-control", cwd: fs.realpathSync(tempDir) });
		fs.writeFileSync(parentSessionFile, `${header}\n`);
		fs.writeFileSync(sessionFile, `${header}\n`);
		const ctx = {
			...makeMinimalCtx(tempDir),
			sessionManager: {
				getSessionId: () => "startup-control-session",
				getSessionFile: () => parentSessionFile,
				getLeafId: () => "leaf",
				openSession: () => ({ createBranchedSession: () => sessionFile }),
			},
		};
		mockPi.onCall({ output: "Initial work" });
		const executor = makeAsyncExecutor(agents);
		const launch = await executor.execute(
			"startup-control-launch", { agent: "worker", task: "Do work", async: true, context: "fork", acceptance: false },
			new AbortController().signal, undefined, ctx,
		) as AsyncExecutionResult;
		assert.ok(!launch.isError, launch.content[0]?.text);
		assert.ok(launch.details.asyncId);
		await readAsyncPayload(launch.details.asyncId);

		const observedControls = path.join(tempDir, "observed-startup-controls.jsonl");
		const preloadFile = path.join(tempDir, "observe-startup-controls.mjs");
		fs.writeFileSync(preloadFile, `
import { createRequire, syncBuiltinESMExports } from "node:module";
const require = createRequire(import.meta.url);
const fs = require("node:fs");
const originalReadFileSync = fs.readFileSync;
const observed = new Set();
fs.readFileSync = function(filePath) {
	const value = originalReadFileSync.apply(this, arguments);
	const match = String(filePath).match(/runner-startup-(ack|confirm|proceed)\\.json$/);
	if (match && typeof value === "string") {
		try {
			const payload = JSON.parse(value);
			const event = JSON.stringify({ file: match[1], action: payload.action });
			if (!observed.has(event)) {
				observed.add(event);
				fs.appendFileSync(${JSON.stringify(observedControls)}, event + "\\n");
			}
		} catch {}
	}
	return value;
};
syncBuiltinESMExports();
`);
		mockPi.onCall({ output: "Continued work" });
		const previousNodeOptions = process.env.NODE_OPTIONS;
		let resumed: AsyncExecutionResult;
		try {
			process.env.NODE_OPTIONS = [previousNodeOptions, `--import=${pathToFileURL(preloadFile).href}`].filter(Boolean).join(" ");
			resumed = await executor.execute(
				"startup-control-resume", { action: "resume", id: launch.details.asyncId, message: "Continue", acceptance: false },
				new AbortController().signal, undefined, ctx,
			) as AsyncExecutionResult;
		} finally {
			if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS;
			else process.env.NODE_OPTIONS = previousNodeOptions;
		}
		assert.ok(!resumed.isError, resumed.content[0]?.text);
		assert.ok(resumed.details.asyncId);
		assert.equal((await readAsyncPayload(resumed.details.asyncId)).success, true);
		assert.deepEqual(
			fs.readFileSync(observedControls, "utf8").trim().split("\n").map((line) => JSON.parse(line)),
			[
				{ file: "ack", action: "ack" },
				{ file: "confirm", action: "confirm" },
				{ file: "proceed", action: "proceed" },
			],
		);
	});

	it("aligns initial and resumed background forked sessions with an explicit child cwd", { skip: !isAsyncAvailable() || !createSubagentExecutor ? "jiti or executor not available" : undefined }, async () => {
		mockPi.onCall({ output: "Forked async work" });
		const parentCwd = fs.realpathSync(tempDir);
		const childCwd = path.join(tempDir, "child-cwd");
		fs.mkdirSync(childCwd);
		const parentSessionFile = path.join(tempDir, "parent-cross-cwd.jsonl");
		const forkedSessionFile = path.join(tempDir, "forked-cross-cwd.jsonl");
		const parentHeader = { type: "session", version: 1, id: "parent", cwd: parentCwd };
		const childHeader = { type: "session", version: 1, id: "child", cwd: parentCwd, parentSession: parentSessionFile };
		fs.writeFileSync(parentSessionFile, `${JSON.stringify(parentHeader)}\n`, "utf-8");
		fs.writeFileSync(forkedSessionFile, `${JSON.stringify(childHeader)}\n`, "utf-8");
		const ctx = {
			...makeMinimalCtx(parentCwd),
			sessionManager: {
				getSessionId: () => "session-cross-cwd",
				getSessionFile: () => parentSessionFile,
				getLeafId: () => "leaf-current",
				openSession: () => ({ createBranchedSession: () => forkedSessionFile }),
			},
		};

		const executor = makeAsyncExecutor([makeAgent("worker")]);
		const launch = await executor.execute(
			"forked-cross-cwd",
			{ agent: "worker", task: "Do work", async: true, context: "fork", cwd: childCwd },
			new AbortController().signal,
			undefined,
			ctx,
		) as AsyncExecutionResult;
		assert.ok(!launch.isError, launch.content[0]?.text);
		assert.ok(launch.details.asyncId);
		await readAsyncPayload(launch.details.asyncId);

		const sessionHeader = JSON.parse(fs.readFileSync(forkedSessionFile, "utf-8").split("\n", 1)[0]!) as { cwd?: string };
		assert.equal(sessionHeader.cwd, fs.realpathSync.native(childCwd));

		fs.writeFileSync(forkedSessionFile, `${JSON.stringify(childHeader)}\n`, "utf-8");
		mockPi.onCall({ output: "Resumed async work" });
		const resumed = await executor.execute(
			"resume-cross-cwd",
			{ action: "resume", id: launch.details.asyncId, message: "Continue" },
			new AbortController().signal,
			undefined,
			ctx,
		) as AsyncExecutionResult;
		assert.ok(!resumed.isError, resumed.content[0]?.text);
		assert.ok(resumed.details.asyncId);
		await readAsyncPayload(resumed.details.asyncId);

		const resumedHeader = JSON.parse(fs.readFileSync(forkedSessionFile, "utf-8").split("\n", 1)[0]!) as { cwd?: string };
		assert.equal(resumedHeader.cwd, fs.realpathSync.native(childCwd));
	});

	it("background forked runs inherit a parent model outside the registry", { skip: !isAsyncAvailable() || !createSubagentExecutor ? "jiti or executor not available" : undefined }, async () => {
		mockPi.onCall({ output: "Forked async work" });
		const parentSessionFile = path.join(tempDir, "parent.jsonl");
		const forkedSessionFile = path.join(tempDir, "forked.jsonl");
		const sessionHeader = JSON.stringify({ type: "session", cwd: fs.realpathSync(tempDir) });
		fs.writeFileSync(parentSessionFile, `${sessionHeader}\n`, "utf-8");
		fs.writeFileSync(forkedSessionFile, `${sessionHeader}\n`, "utf-8");
		const ctx = {
			...makeMinimalCtx(tempDir),
			model: { provider: "gateway", id: "parent-model" },
			modelRegistry: { getAvailable: () => [{ provider: "openai", id: "gpt-5-mini" }] },
			sessionManager: {
				getSessionId: () => "session-123",
				getSessionFile: () => parentSessionFile,
				getLeafId: () => "leaf-current",
				openSession: () => ({ createBranchedSession: () => forkedSessionFile }),
			},
		};
		const launch = await makeAsyncExecutor([makeAgent("worker")]).execute(
			"forked-parent-model",
			{ agent: "worker", task: "Do work", async: true, context: "fork" },
			new AbortController().signal,
			undefined,
			ctx,
		) as AsyncExecutionResult;
		assert.ok(!launch.isError, launch.content[0]?.text);
		assert.ok(launch.details.asyncId);
		const payload = await readAsyncPayload(launch.details.asyncId);
		assert.equal(payload.results[0]?.model, "gateway/parent-model");
	});

	it("background forked runs receive the derived fork cache key", { skip: !isAsyncAvailable() || !createSubagentExecutor ? "jiti or executor not available" : undefined }, async () => {
		mockPi.onCall({ output: "cache affinity inspected" });
		const parentSessionFile = path.join(tempDir, "parent-cache.jsonl");
		const forkedSessionFile = path.join(tempDir, "forked-cache.jsonl");
		const sessionHeader = JSON.stringify({ type: "session", cwd: fs.realpathSync(tempDir) });
		fs.writeFileSync(parentSessionFile, `${sessionHeader}\n`, "utf-8");
		fs.writeFileSync(forkedSessionFile, `${sessionHeader}\n`, "utf-8");
		const ctx = {
			...makeMinimalCtx(tempDir),
			sessionManager: {
				getSessionId: () => "session-cache-parent",
				getSessionFile: () => parentSessionFile,
				getLeafId: () => "leaf-current",
				openSession: () => ({ createBranchedSession: () => forkedSessionFile }),
			},
		};

		const launch = await makeAsyncExecutor([makeAgent("worker")]).execute(
			"forked-cache-key",
			{ agent: "worker", task: "Inspect cache affinity", async: true, context: "fork" },
			new AbortController().signal,
			undefined,
			ctx,
		) as AsyncExecutionResult;
		assert.ok(!launch.isError, launch.content[0]?.text);
		assert.ok(launch.details.asyncId);

		const payload = await readAsyncPayload(launch.details.asyncId);
		assert.equal(payload.success, true);
		assert.equal((await waitForMockPiRuntime(mockPi, 0)).forkCacheKey, deriveForkPromptCacheKey("session-cache-parent"));
	});

	it("follows up an async run whose recovery descriptor includes fast", { skip: !isAsyncAvailable() || !createSubagentExecutor ? "jiti or executor not available" : undefined }, async () => {
		const luna = { provider: "openai-codex", id: "gpt-5.6-luna", fullId: "openai-codex/gpt-5.6-luna" };
		mockPi.onCall({ output: "Initial async work" });
		const sourceId = `async-revive-fast-${Date.now().toString(36)}`;
		const sessionFile = path.join(tempDir, "sessions", "fast.jsonl");
		fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
		fs.writeFileSync(sessionFile, "", "utf-8");
		executeAsyncSingle(sourceId, {
			agent: "worker",
			task: "Initial work",
			agentConfig: makeAgent("worker", { model: luna.fullId }),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-123" },
			artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
			sessionRoot: path.join(tempDir, "sessions"),
			sessionFile,
			modelOverride: luna.fullId,
			availableModels: [luna],
			fast: true,
			maxSubagentDepth: 2,
		});
		await readAsyncPayload(sourceId);
		assert.equal(JSON.parse(fs.readFileSync(path.join(ASYNC_DIR, sourceId, "recovery-descriptor.json"), "utf-8")).fast, true);

		mockPi.onCall({ output: "Revived async work" });
		const result = await makeAsyncExecutor([makeAgent("worker")]).execute(
			"revive-fast",
			{ action: "resume", id: sourceId, message: "Continue" },
			new AbortController().signal,
			undefined,
			{ ...makeMinimalCtx(tempDir), modelRegistry: { getAvailable: () => [luna] } },
		) as AsyncExecutionResult;
		assert.ok(!result.isError, result.content[0]?.text);
		assert.ok(result.details.asyncId);
		assert.equal((await readAsyncPayload(result.details.asyncId)).success, true);
	});

	it("revives an inherited parent model outside the current registry", { skip: !isAsyncAvailable() || !createSubagentExecutor ? "jiti or executor not available" : undefined }, async () => {
		mockPi.onCall({ output: "Initial async work" });
		const sourceId = `async-revive-parent-model-${Date.now().toString(36)}`;
		const sessionFile = path.join(tempDir, "sessions", "source.jsonl");
		fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
		fs.writeFileSync(sessionFile, "", "utf-8");
		executeAsyncSingle(sourceId, {
			agent: "worker",
			task: "Initial work",
			agentConfig: makeAgent("worker"),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-123" },
			artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
			sessionRoot: path.join(tempDir, "sessions"),
			sessionFile,
			modelOverride: "gateway/parent-model",
			modelOverrideFromParent: true,
			maxSubagentDepth: 2,
		});
		await readAsyncPayload(sourceId);
		const descriptor = JSON.parse(fs.readFileSync(path.join(ASYNC_DIR, sourceId, "recovery-descriptor.json"), "utf-8"));
		assert.equal(descriptor.modelOverrideFromParent, true);
		assert.equal(descriptor.modelOrigin, "inherited");

		mockPi.onCall({ output: "Revived async work" });
		const result = await makeAsyncExecutor([makeAgent("worker")]).execute(
			"revive-parent-model",
			{ action: "resume", id: sourceId, message: "Continue" },
			new AbortController().signal,
			undefined,
			makeMinimalCtx(tempDir),
		) as AsyncExecutionResult;
		assert.ok(!result.isError, result.content[0]?.text);
		assert.ok(result.details.asyncId);
		const payload = await readAsyncPayload(result.details.asyncId);
		assert.equal(payload.results[0]?.model, "gateway/parent-model");
	});

	it("reports the retained discovery context when a resumed target agent is missing", { skip: !createSubagentExecutor ? "executor not available" : undefined }, async () => {
		const runId = `resume-missing-agent-${Date.now().toString(36)}`;
		const asyncDir = path.join(ASYNC_DIR, runId);
		const sessionFile = path.join(tempDir, "missing-agent-session.jsonl");
		const visible = makeAgent("visible");
		visible.source = "project";
		const evidenceDir = path.join(tempDir, "request-discovery", "agents");
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
				steps: [{ agent: "vanished", status: "complete" }],
			}, null, 2), "utf-8");
			const executor = makeAsyncExecutor([visible], {}, (cwd) => ({
				agents: [visible],
				cwd: path.resolve(cwd),
				scope: "both",
				directories: [{ source: "project", path: evidenceDir, state: "empty" }],
			}));
			const result = await executor.execute(
				"resume-missing-agent",
				{ action: "resume", id: runId, message: "Continue" },
				new AbortController().signal,
				undefined,
				makeMinimalCtx(tempDir),
			) as AsyncExecutionResult;
			assert.equal(result.isError, true);
			assert.match(result.content[0]?.text ?? "", /^Unknown agent for resume: vanished\nEffective cwd: /);
			assert.match(result.content[0]?.text ?? "", new RegExp(evidenceDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
			assert.match(result.content[0]?.text ?? "", /visible \(project\)/);
		} finally {
			fs.rmSync(asyncDir, { recursive: true, force: true });
		}
	});

	it("background runs resolve skills from the effective task cwd", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({ output: "Done asynchronously" });
		const taskCwd = createTempDir("pi-subagent-async-task-cwd-");
		const id = `async-skill-cwd-${Date.now().toString(36)}`;
		const asyncDir = path.join(ASYNC_DIR, id);
		const resultPath = path.join(RESULTS_DIR, `${id}.json`);
		const statusPath = path.join(asyncDir, "status.json");

		try {
			writePackageSkill(taskCwd, "async-task-cwd-skill");
			executeAsyncSingle(id, {
				agent: "worker",
				task: "Do work",
				agentConfig: makeAgent("worker", { skills: ["async-task-cwd-skill"] }),
				ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
				cwd: taskCwd,
				artifactConfig: {
					enabled: false,
					includeInput: false,
					includeOutput: false,
					includeJsonl: false,
					includeMetadata: false,
					cleanupDays: 7,
				},
				sessionRoot: path.join(tempDir, "sessions"),
				maxSubagentDepth: 2,
			});

			const deadline = Date.now() + 10_000;
			while (!fs.existsSync(resultPath)) {
				if (Date.now() > deadline) {
					assert.fail(`Timed out waiting for async result file: ${resultPath}`);
				}
				await new Promise((resolve) => setTimeout(resolve, 100));
			}

			const payload = JSON.parse(fs.readFileSync(resultPath, "utf-8")) as AsyncResultPayload;
			const status = JSON.parse(fs.readFileSync(statusPath, "utf-8")) as AsyncStatusPayload;
			assert.equal(payload.success, true);
			assert.deepEqual(status.steps?.[0]?.skills, ["async-task-cwd-skill"]);
		} finally {
			removeTempDir(taskCwd);
		}
	});

	it("injects agent-file-relative local skills into background single child prompts", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({ output: "Done asynchronously" });
		const id = `async-local-skill-${Date.now().toString(36)}`;
		const agentFile = path.join(tempDir, "agents", "worker", "worker.md");
		const skillFile = path.join(path.dirname(agentFile), "skills", "local", "SKILL.md");
		fs.mkdirSync(path.dirname(skillFile), { recursive: true });
		fs.writeFileSync(skillFile, "---\ndescription: async local skill\n---\nLocal skill body\n", "utf-8");

		executeAsyncSingle(id, {
			agent: "worker",
			task: "Do work",
			agentConfig: makeAgent("worker", { filePath: agentFile, skills: ["local"], skillPath: ["./skills"] }),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
			maxSubagentDepth: 2,
		});

		await waitForAsyncResultFile(id);
		const call = await waitForMockPiCall(mockPi, 0);
		assert.match(call.systemPrompts.map((record) => record.text ?? "").join("\n"), /async local skill/);
	});

	it("background single runs report unavailable pi-subagents skill requests", () => {
		const id = `async-pi-subagents-skill-${Date.now().toString(36)}`;
		const result = executeAsyncSingle(id, {
			agent: "worker",
			task: "Do work",
			agentConfig: makeAgent("worker"),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			cwd: tempDir,
			artifactConfig: {
				enabled: false,
				includeInput: false,
				includeOutput: false,
				includeJsonl: false,
				includeMetadata: false,
				cleanupDays: 7,
			},
			sessionRoot: path.join(tempDir, "sessions"),
			skills: ["pi-subagents"],
			maxSubagentDepth: 2,
		});

		assert.equal(result.isError, true);
		assert.match(result.content[0]?.text ?? "", /Skills not found: pi-subagents/);
	});

	it("returns a tool error when the detached runner config cannot be written", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, () => {
		const id = `async-write-fail-${Date.now().toString(36)}`;
		assert.ok(TEMP_ROOT_DIR, "TEMP_ROOT_DIR should be available for async tests");
		fs.mkdirSync(TEMP_ROOT_DIR, { recursive: true });
		fs.mkdirSync(path.join(TEMP_ROOT_DIR, `async-cfg-${id}.json`), { recursive: true });

		const result = executeAsyncSingle(id, {
			agent: "worker",
			task: "Do work",
			agentConfig: makeAgent("worker"),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: {
				enabled: false,
				includeInput: false,
				includeOutput: false,
				includeJsonl: false,
				includeMetadata: false,
				cleanupDays: 7,
			},
			sessionRoot: path.join(tempDir, "sessions"),
			maxSubagentDepth: 2,
		});

		assert.equal(result.isError, true);
		assert.match(result.content[0]?.text ?? "", /Failed to start async run/);
		assert.match(result.content[0]?.text ?? "", /async-cfg-/);
	});

	it("returns promptly when a revival runner exits before startup readiness", { timeout: 90_000, skip: !isAsyncAvailable() || !createSubagentExecutor ? "jiti or executor not available" : undefined }, async () => {
		const sourceId = `async-revive-exit-before-ready-${Date.now().toString(36)}`;
		const sessionFile = path.join(tempDir, "revival-exit-session.jsonl");
		fs.writeFileSync(sessionFile, `${JSON.stringify({ type: "session", version: 1, id: "revival-exit-session", cwd: fs.realpathSync(tempDir) })}\n`);
		mockPi.onCall({ output: "Initial work" });
		executeAsyncSingle(sourceId, {
			agent: "worker",
			task: "Initial work",
			agentConfig: makeAgent("worker"),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-123" },
			artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
			sessionFile,
			maxSubagentDepth: 2,
		});
		const initialResult = JSON.parse(fs.readFileSync(await waitForAsyncResultFile(sourceId, 60_000), "utf8")) as { success: boolean };
		assert.equal(initialResult.success, true);

		const preloadFile = path.join(tempDir, "exit-before-ready.mjs");
		fs.writeFileSync(preloadFile, `
if (process.argv.some((arg) => arg.endsWith("subagent-runner-bootstrap.ts"))) process.exit(1);
`);
		const previousNodeOptions = process.env.NODE_OPTIONS;
		const startedAt = Date.now();
		let failed: AsyncExecutionResult;
		try {
			process.env.NODE_OPTIONS = [previousNodeOptions, `--import=${pathToFileURL(preloadFile).href}`].filter(Boolean).join(" ");
			failed = await makeAsyncExecutor([makeAgent("worker")]).execute(
				"resume-exit-before-ready",
				{ action: "resume", id: sourceId, message: "Continue" },
				new AbortController().signal,
				undefined,
				makeMinimalCtx(tempDir),
			) as AsyncExecutionResult;
		} finally {
			if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS;
			else process.env.NODE_OPTIONS = previousNodeOptions;
		}
		assert.equal(failed.isError, true);
		assert.match(failed.content[0]?.text ?? "", /runner exited before startup state 'ready'/);
		assert.ok(Date.now() - startedAt < 5_000, "runner exit must interrupt startup wait promptly");
		const failedRun = fs.readdirSync(ASYNC_DIR).map((runId) => path.join(ASYNC_DIR, runId)).find((asyncDir) => {
			try { return JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8")).error?.includes("runner exited before startup state 'ready'"); } catch { return false; }
		});
		assert.ok(failedRun);
		const failedStatus = JSON.parse(fs.readFileSync(path.join(failedRun, "status.json"), "utf8")) as { processTerminal?: unknown };
		const failedTerminal = JSON.parse(fs.readFileSync(path.join(failedRun, "process-terminal.json"), "utf8"));
		assert.deepEqual(failedStatus.processTerminal, failedTerminal, "status and terminal proof must agree after an early runner exit");
	});

	it("does not proceed when a real revival runner exits after acknowledgement", async () => {
		const id = `acknowledged-runner-closure-${Date.now().toString(36)}`;
		const asyncDir = path.join(ASYNC_DIR, id);
		const sessionId = `session-${id}`;
		const sessionFile = path.join(tempDir, `${id}.jsonl`);
		fs.writeFileSync(sessionFile, `${JSON.stringify({ type: "session", version: 1, id: `child-${id}`, cwd: fs.realpathSync(tempDir) })}\n`);
		const capacity = acquireActiveAsyncCapacity({ sessionId, limit: 1, runId: id, kind: "runner", asyncDir });
		assert.ok(capacity);
		const eventsSeen: string[] = [];
		const processEvents: Array<{ type: "exit" | "close"; exitCode: number | null; signal: NodeJS.Signals | null }> = [];
		let runnerProcess: ChildProcess | undefined;
		let terminalEmission: { proof: unknown; status: unknown; candidate: unknown } | undefined;
		const childProcessChannel = channel("child_process");
		const observeProcess = (message: unknown) => {
			const proc = (message as { process?: unknown }).process;
			if (!(proc instanceof ChildProcess) || runnerProcess !== undefined) return;
			runnerProcess = proc;
			proc.once("exit", (exitCode, signal) => { processEvents.push({ type: "exit", exitCode, signal }); });
			proc.once("close", (exitCode, signal) => { processEvents.push({ type: "close", exitCode, signal }); });
		};
		const preloadFile = path.join(tempDir, `${id}-exit-after-ack.mjs`);
		fs.writeFileSync(preloadFile, `
import { createRequire, syncBuiltinESMExports } from "node:module";
const require = createRequire(import.meta.url);
const fs = require("node:fs");
const originalRenameSync = fs.renameSync;
fs.renameSync = function(source, destination) {
	const result = originalRenameSync.apply(this, arguments);
	if (String(destination).endsWith("runner-startup.json")) {
		try {
			if (JSON.parse(fs.readFileSync(destination, "utf8")).state === "acknowledged") process.exit(42);
		} catch {}
	}
	return result;
};
syncBuiltinESMExports();
`);
		const callsBefore = fs.readdirSync(mockPi.dir).filter((name) => name.startsWith("call-")).length;
		const previousNodeOptions = process.env.NODE_OPTIONS;
		childProcessChannel.subscribe(observeProcess);
		let result: AsyncExecutionResult;
		try {
			process.env.NODE_OPTIONS = [previousNodeOptions, `--import=${pathToFileURL(preloadFile).href}`].filter(Boolean).join(" ");
			result = await Promise.resolve(executeAsyncSingle(id, {
				agent: "worker",
				task: "Must never start",
				agentConfig: makeAgent("worker"),
				ctx: { pi: { events: { emit(type: string, proof: unknown) {
					eventsSeen.push(type);
					if (type === "subagent:process-terminal" && (proof as { runId?: unknown }).runId === id) {
						terminalEmission = {
							proof,
							status: JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8")),
							candidate: JSON.parse(fs.readFileSync(path.join(asyncDir, "process-terminal-candidate.json"), "utf8")),
						};
					}
				} } }, cwd: tempDir, currentSessionId: sessionId },
				artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
				sessionFile,
				revivalLease: { sessionFile, runId: id, sourceRunId: `source-${id}`, parentSessionId: sessionId },
				activeAsyncCapacity: capacity,
				maxSubagentDepth: 2,
			}));
		} finally {
			childProcessChannel.unsubscribe(observeProcess);
			if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS;
			else process.env.NODE_OPTIONS = previousNodeOptions;
		}
		assert.equal(result.isError, true);
		assert.deepEqual(result.details.results, []);
		const runnerPid = runnerProcess?.pid;
		assert.equal(typeof runnerPid, "number");
		assert.deepEqual(processEvents, [
			{ type: "exit", exitCode: 42, signal: null },
			{ type: "close", exitCode: 42, signal: null },
		]);
		assert.equal(eventsSeen.includes("subagent:async-started"), false);
		assert.equal(fs.existsSync(path.join(asyncDir, "runner-startup-proceed.json")), false);
		assert.equal(fs.readdirSync(mockPi.dir).filter((name) => name.startsWith("call-")).length, callsBefore, "child session must not start");
		assert.equal(getActiveAsyncCapacitySnapshot(sessionId, 1).used, 0, "launch failure must roll capacity back automatically");
		const status = JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8"));
		const terminal = JSON.parse(fs.readFileSync(path.join(asyncDir, "process-terminal.json"), "utf8"));
		assert.equal(status.state, "failed");
		assert.equal(typeof status.error, "string");
		assert.match(status.error, /exited before startup state '(?:acknowledged|confirmed)' \(exit code 42, signal none\)/);
		assert.equal(result.content[0]?.text, `Failed to start async run '${id}': ${status.error}`);
		assert.equal(status.runnerPid, runnerPid);
		assert.equal(terminal.state, "observed");
		assert.equal(terminal.runId, id);
		assert.equal(terminal.runnerProcessInstanceId, terminalEmission && (terminalEmission.candidate as { runnerProcessInstanceId?: unknown }).runnerProcessInstanceId);
		assert.deepEqual(terminal.instances, [{ kind: "runner", processInstanceId: terminal.runnerProcessInstanceId, closeObservedAt: terminal.instances[0].closeObservedAt, exitCode: 42, signal: null }]);
		assert.deepEqual(status.processTerminal, terminal);
		assert.deepEqual(terminalEmission && terminalEmission.proof, terminal);
		assert.equal(terminalEmission && (terminalEmission.status as { state?: unknown }).state, "failed");
		assert.equal(terminalEmission && (terminalEmission.status as { error?: unknown }).error, status.error);
		assert.deepEqual(terminalEmission && (terminalEmission.status as { processTerminal?: unknown }).processTerminal, terminal);
		assert.ok(terminalEmission);
		assert.equal(Object.values((terminalEmission.candidate as { expectedWriters: Record<string, number> }).expectedWriters).every((count) => count === 0), true);
		assert.equal(fs.existsSync(path.join(RESULTS_DIR, `${id}.json`)), false, "a pre-proceed exit must not publish a result");
	});

	for (const revival of [false, true]) {
		it(`${revival ? "revival" : "fresh"} post-proceed import rejection settles parent-owned lifecycle`, async () => {
			const id = `post-proceed-import-${revival ? "revival" : "fresh"}-${Date.now().toString(36)}`;
			const asyncDir = path.join(ASYNC_DIR, id);
			const sessionId = `session-${id}`;
			const startedPath = path.join(tempDir, `${id}-import-started`);
			const rejectPath = path.join(tempDir, `${id}-reject`);
			const watchStartedPath = path.join(tempDir, `${id}-watch-started`);
			const rejectSeenPath = path.join(tempDir, `${id}-reject-seen`);
			const fixturePath = path.join(tempDir, `${id}-execution.mjs`);
			fs.writeFileSync(fixturePath, `
import fs from "node:fs";
import path from "node:path";
const started = process.env.PI_SUBAGENTS_TEST_IMPORT_STARTED;
const reject = process.env.PI_SUBAGENTS_TEST_IMPORT_REJECT;
const watchStarted = ${JSON.stringify(watchStartedPath)};
const rejectSeen = ${JSON.stringify(rejectSeenPath)};
const mark = (file, text) => { try { fs.writeFileSync(file, text); } catch {} };
fs.writeFileSync(started, "started");
await new Promise((resolve) => {
  mark(watchStarted, "watching");
  // fs.watchFile missed the parent's rejection marker on Ubuntu CI; poll existence directly.
  const timer = setInterval(() => { if (fs.existsSync(reject)) { clearInterval(timer); mark(rejectSeen, "seen"); resolve(); } }, 20);
});
throw new Error("injected parent-visible heavy import rejection");
`);
			const sessionFile = path.join(tempDir, `${id}.jsonl`);
			if (revival) fs.writeFileSync(sessionFile, `${JSON.stringify({ type: "session", version: 1, id: `child-${id}`, cwd: fs.realpathSync(tempDir) })}\n`);
			const callsBefore = fs.readdirSync(mockPi.dir).filter((name) => name.startsWith("call-")).length;
			const previousModule = process.env.PI_SUBAGENTS_TEST_RUNNER_EXECUTION_MODULE;
			const previousStarted = process.env.PI_SUBAGENTS_TEST_IMPORT_STARTED;
			const previousReject = process.env.PI_SUBAGENTS_TEST_IMPORT_REJECT;
			const processEvents = new Map<number, Array<{ type: "exit" | "close"; at: string; exitCode: number | null; signal: NodeJS.Signals | null }>>();
			const childProcessChannel = channel("child_process");
			const observeProcess = (message: unknown) => {
				// Diagnostics must never affect the spawn they observe.
				try {
					const proc = (message as { process?: unknown }).process;
					if (!(proc instanceof ChildProcess) || typeof proc.pid !== "number") return;
					const pid = proc.pid;
					const seen: Array<{ type: "exit" | "close"; at: string; exitCode: number | null; signal: NodeJS.Signals | null }> = [];
					processEvents.set(pid, seen);
					proc.once("exit", (exitCode, signal) => { seen.push({ type: "exit", at: new Date().toISOString(), exitCode, signal }); });
					proc.once("close", (exitCode, signal) => { seen.push({ type: "close", at: new Date().toISOString(), exitCode, signal }); });
				} catch {}
			};
			const timeoutDetails = () => {
				const read = (name: string) => {
					try { return fs.readFileSync(path.join(asyncDir, name), "utf8"); } catch (error) { return `<${(error as NodeJS.ErrnoException).code ?? "unreadable"}>`; }
				};
				const status = (() => { try { return JSON.parse(read("status.json")) as { runnerPid?: unknown }; } catch { return {}; } })();
				const pid = status.runnerPid;
				let liveness = "unknown (no runner PID in status.json)";
				if (typeof pid === "number") {
					try { process.kill(pid, 0); liveness = "PID exists (not proof of runner identity or exit)"; }
					catch (error) { liveness = `PID check failed: ${(error as NodeJS.ErrnoException).code ?? String(error)}`; }
				}
				return [
					`diagnostic timestamp: ${new Date().toISOString()}`,
					`process-terminal.json: ${read("process-terminal.json")}`,
					`process-terminal-candidate.json: ${read("process-terminal-candidate.json")}`,
					`runner-startup-proceed.json (authorization, not readiness): ${read("runner-startup-proceed.json")}`,
					`events.jsonl tail: ${read("events.jsonl").slice(-4000)}`,
					`fixture markers: ${JSON.stringify({ importStarted: fs.existsSync(startedPath), rejection: fs.existsSync(rejectPath), watchStarted: fs.existsSync(watchStartedPath), rejectSeen: fs.existsSync(rejectSeenPath) })}`,
					`runner PID ${String(pid)} liveness: ${liveness}`,
					`runner ChildProcess events: ${JSON.stringify(typeof pid === "number" ? processEvents.get(pid) ?? "not captured" : "PID unavailable")}`,
				].join("\n");
			};
			childProcessChannel.subscribe(observeProcess);
			try {
				try {
					process.env.PI_SUBAGENTS_TEST_RUNNER_EXECUTION_MODULE = pathToFileURL(fixturePath).href;
					process.env.PI_SUBAGENTS_TEST_IMPORT_STARTED = startedPath;
					process.env.PI_SUBAGENTS_TEST_IMPORT_REJECT = rejectPath;
					executeAsyncSingle(id, {
						agent: "worker", task: "Must never start", agentConfig: makeAgent("worker"),
						ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: sessionId },
						artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
						...(revival ? { sessionFile, revivalLease: { sessionFile, runId: id, sourceRunId: `source-${id}`, parentSessionId: sessionId } } : {}),
						maxSubagentDepth: 2,
					});
					await waitForPath(startedPath, asyncDir);
				} finally {
					if (previousModule === undefined) delete process.env.PI_SUBAGENTS_TEST_RUNNER_EXECUTION_MODULE; else process.env.PI_SUBAGENTS_TEST_RUNNER_EXECUTION_MODULE = previousModule;
					if (previousStarted === undefined) delete process.env.PI_SUBAGENTS_TEST_IMPORT_STARTED; else process.env.PI_SUBAGENTS_TEST_IMPORT_STARTED = previousStarted;
					if (previousReject === undefined) delete process.env.PI_SUBAGENTS_TEST_IMPORT_REJECT; else process.env.PI_SUBAGENTS_TEST_IMPORT_REJECT = previousReject;
				}
				assert.equal(fs.readdirSync(mockPi.dir).filter((name) => name.startsWith("call-")).length, callsBefore);
				fs.writeFileSync(rejectPath, "reject");
				const terminal = await waitForJson<{ state: string }>(path.join(asyncDir, "process-terminal.json"), (value) => value.state !== "pending", asyncDir, timeoutDetails);
				const status = JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8"));
				const candidate = JSON.parse(fs.readFileSync(path.join(asyncDir, "process-terminal-candidate.json"), "utf8"));
				assert.equal(status.state, "failed");
				assert.match(status.error, /injected parent-visible heavy import rejection/);
				assert.equal(terminal.state, "observed");
				assert.deepEqual(candidate.writers, {});
				assert.deepEqual(candidate.expectedWriters, { 0: 0 });
				assert.equal(readActiveRunIndex(ASYNC_DIR)?.includes(id) ?? false, false);
				assert.equal(getActiveAsyncCapacitySnapshot(sessionId, 1).used, 0);
				assert.equal(fs.existsSync(path.join(RESULTS_DIR, `${id}.json`)), false);
				if (revival) {
					assert.equal(fs.realpathSync(candidate.sessionFile), fs.realpathSync(sessionFile));
					assert.equal(typeof candidate.revivalLeaseToken, "string");
					assert.equal(candidate.revivalLeaseReleaseAcknowledged, true);
				}
			} finally {
				childProcessChannel.unsubscribe(observeProcess);
			}
		});
	}

	for (const revival of [false, true]) {
		it(`${revival ? "revival" : "fresh"} post-import setup rejection settles parent-owned lifecycle`, async () => {
			const id = `post-import-setup-${revival ? "revival" : "fresh"}-${Date.now().toString(36)}`;
			const asyncDir = path.join(ASYNC_DIR, id);
			const sessionId = `session-${id}`;
			const startedPath = path.join(tempDir, `${id}-setup-started`);
			const rejectPath = path.join(tempDir, `${id}-setup-reject`);
			const factoryPath = path.join(tempDir, `${id}-factory.mjs`);
			fs.writeFileSync(factoryPath, `
import fs from "node:fs";
import path from "node:path";
const started = ${JSON.stringify(startedPath)};
const reject = ${JSON.stringify(rejectPath)};
fs.writeFileSync(started, "started");
await new Promise((resolve) => {
  const timer = setInterval(() => { if (fs.existsSync(reject)) { clearInterval(timer); resolve(); } }, 20);
});
throw new Error("injected pre-run child factory rejection");
`);
			const sessionFile = path.join(tempDir, `${id}.jsonl`);
			if (revival) fs.writeFileSync(sessionFile, `${JSON.stringify({ type: "session", version: 1, id: `child-${id}`, cwd: fs.realpathSync(tempDir) })}\n`);
			const callsBefore = fs.readdirSync(mockPi.dir).filter((name) => name.startsWith("call-")).length;
			const originalFactoryModule = childSessionFactoryModule();
			try {
				setChildSessionFactoryModule(factoryPath);
				const common = {
					ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: sessionId },
					artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
					maxSubagentDepth: 2,
				};
				if (revival) {
					executeAsyncSingle(id, {
						agent: "worker", task: "Must never start", agentConfig: makeAgent("worker"), ...common,
						sessionFile, revivalLease: { sessionFile, runId: id, sourceRunId: `source-${id}`, parentSessionId: sessionId },
					});
				} else {
					executeAsyncSingle(id, {
						agent: "worker", task: "First must never start", agentConfig: makeAgent("worker"), ...common, sessionRoot: path.join(tempDir, "sessions"),
					});
				}
				await waitForPath(startedPath, asyncDir);
			} finally {
				setChildSessionFactoryModule(originalFactoryModule);
			}
			assert.equal(fs.readdirSync(mockPi.dir).filter((name) => name.startsWith("call-")).length, callsBefore);
			fs.writeFileSync(rejectPath, "reject");
			const terminal = await waitForJson<{ state: string }>(path.join(asyncDir, "process-terminal.json"), (value) => value.state !== "pending", asyncDir);
			const status = JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8"));
			const candidate = JSON.parse(fs.readFileSync(path.join(asyncDir, "process-terminal-candidate.json"), "utf8"));
			assert.equal(status.state, "failed");
			assert.match(status.error, /injected pre-run child factory rejection/);
			assert.equal(terminal.state, "observed");
			assert.deepEqual(candidate.writers, {});
			assert.deepEqual(candidate.expectedWriters, { 0: 0 });
			assert.equal(readActiveRunIndex(ASYNC_DIR)?.includes(id) ?? false, false);
			assert.equal(getActiveAsyncCapacitySnapshot(sessionId, 1).used, 0);
			assert.equal(fs.existsSync(path.join(RESULTS_DIR, `${id}.json`)), false);
			if (revival) {
				assert.equal(fs.realpathSync(candidate.sessionFile), fs.realpathSync(sessionFile));
				assert.equal(typeof candidate.revivalLeaseToken, "string");
				assert.equal(candidate.revivalLeaseReleaseAcknowledged, true);
			}
		});
	}

});
