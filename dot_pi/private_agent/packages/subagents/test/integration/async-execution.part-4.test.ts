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
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { createServer, type Socket } from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import { createEventBus, createTempDir, events, makeAgent, removeTempDir } from "../support/helpers.ts";
import { deliverInterruptRequest, deliverStopRequest, requestAsyncSteer } from "../../src/runs/background/control-channel.ts";
import { SUBAGENT_PROCESS_TERMINAL_EVENT } from "../../src/shared/types.ts";
import { waitForSubagents } from "../../src/runs/background/subagent-wait.ts";
import type { AsyncResultPayload, AsyncStatusPayload } from "../support/async-execution-fixture.ts";
import {
	installAsyncExecutionHooks, available, isAsyncAvailable, executeAsyncSingle,
	ASYNC_DIR, RESULTS_DIR, escapeRegExp,
	createRepo, waitForAsyncResultFile, waitForAsyncState, tempDir, mockPi,
	readAsyncPayload, waitForMockPiCall,
} from "../support/async-execution-fixture.ts";

describe("async execution utilities", { skip: !available ? "pi packages not available" : undefined }, () => {
	installAsyncExecutionHooks();

	for (const mode of ["success", "stop", "pause", "deadline"] as const) {
		it(`background setup lifecycle: ${mode}`, { skip: !isAsyncAvailable() || process.platform === "win32" ? "requires real POSIX setup executable" : undefined, timeout: 25_000 }, async (t) => {
			const repo = createRepo("pi-background-setup-");
			const baseDir = createTempDir();
			const id = `async-setup-${mode}-${Date.now().toString(36)}`;
			const asyncDir = path.join(ASYNC_DIR, id);
			const marker = path.join(repo, ".git", "child-launched");
			const server = createServer();
			server.listen(0, "127.0.0.1");
			await once(server, "listening");
			const { port } = server.address() as { port: number };
			const hook = path.join(baseDir, "setup-hook.cjs");
			fs.writeFileSync(hook, `#!${process.execPath}
// Complete the setup stdin contract before exposing the independent release gate.
// Otherwise the hook can exit before the runner writes input and cause EPIPE.
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
 const setup = JSON.parse(input);
 require('node:assert/strict').equal(setup.runId, ${JSON.stringify(`${id}-s0`)});
 require('node:assert/strict').equal(setup.repoRoot, ${JSON.stringify(fs.realpathSync(repo))});
 const socket = require('node:net').connect(${port}, '127.0.0.1', () => socket.write('ready'));
 socket.on('data', data => {
  if (data.toString() === 'release') { socket.end(); console.log('{}'); }
 });
});
setTimeout(() => process.exit(90), 15000).unref();
`, { mode: 0o755 });
			const bus = createEventBus();
			let closed = false;
			const terminal = new Promise<unknown>((resolve) => bus.on(SUBAGENT_PROCESS_TERMINAL_EVENT, (proof) => { closed = true; resolve(proof); }));
			let socket: Socket | undefined;
			let started = false;
			try {
				mockPi.onCall({ output: "finite setup completed", writeFiles: [{ path: marker, content: "launched" }] });
				const connection = once(server, "connection", { signal: AbortSignal.timeout(20_000) });
				const receipt = executeAsyncSingle(id, {
					agent: "worker", task: "Do work", worktree: true, agentConfig: makeAgent("worker"),
					ctx: { pi: { events: bus }, cwd: repo, currentSessionId: "session-1" },
					artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
					sessionRoot: path.join(tempDir, "sessions"), maxSubagentDepth: 2, acceptance: false,
					worktreeBaseDir: path.join(baseDir, "trees"), worktreeSetupHook: hook,
					...(mode === "deadline" ? { timeoutMs: 4_000 } : {}),
				});
				assert.equal(receipt.isError, undefined, receipt.content[0]?.text);
				started = true;
				[socket] = await Promise.race([connection, terminal.then((proof) => { throw new Error(`Runner closed before setup ready: ${JSON.stringify(proof)}`); })]) as [Socket];
				assert.equal((await once(socket, "data"))[0].toString(), "ready");
				const held = await waitForAsyncState(id, (status) => Boolean(status.parallelHandoff));
				assert.equal(closed, false);
				assert.equal(mockPi.callCount(), 0);
				assert.equal(fs.existsSync(marker), false);
				if (mode === "stop") deliverStopRequest({ asyncDir, source: "test" });
				else if (mode === "pause") deliverInterruptRequest({ asyncDir, source: "test" });
				else if (mode !== "deadline") socket.write("release");
				const payload = await readAsyncPayload(id);
				const proof = await terminal;
				const status = JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf8"));
				const expected = mode === "success" ? "complete" : mode === "stop" ? "stopped" : mode === "pause" ? "paused" : "failed";
				if (payload.state !== expected || status.state !== expected || status.steps?.[0]?.status !== expected) {
					// Failure-only, bounded projections: never print prompts, output, paths or raw stderr.
					const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
					const token = (value: unknown) => typeof value === "string" && /^[a-z_-]{1,64}$/i.test(value) ? value : undefined;
					const errors = (value: unknown) => {
						const text = typeof value === "string" ? value.slice(0, 8192) : "";
						return { present: Boolean(text), kinds: [
							"EPIPE", "ENOENT", "EACCES", "ENOSPC", "ETIMEDOUT", "ABORT_ERR", "ENOBUFS",
							"setup aborted", "setup deadline", "setup settlement unknown", "process tree settlement",
							"empty stdout", "invalid JSON", "hook failed", "manual reconciliation required",
							"not a git repository", "index.lock", "already exists", "Failed to write result",
							"No model", "model not found", "completion", "acceptance",
						].filter((kind) => text.toLowerCase().includes(kind.toLowerCase())), exitCode: text.match(/exit (?:code |status )?(-?\d+)/i)?.[1] };
					};
					const project = (value: unknown) => {
						const item = record(value);
						return { state: token(item.state), status: token(item.status), reason: token(item.reason),
							exitCode: typeof item.exitCode === "number" ? item.exitCode : undefined,
							success: typeof item.success === "boolean" ? item.success : undefined,
							timedOut: item.timedOut === true, stopped: item.stopped === true, error: errors(item.error) };
					};
					let cleanup: unknown;
					try {
						const handoffPath = held.parallelHandoff?.path;
						if (handoffPath && fs.statSync(handoffPath).size <= 65_536) {
							const handoff = JSON.parse(fs.readFileSync(handoffPath, "utf8"));
							cleanup = (handoff.groups ?? []).slice(0, 2).map((group: { cleanup?: { state?: string; pruned?: boolean; tasks?: unknown[]; errors?: string[] } }) => ({
								state: token(group.cleanup?.state), pruned: group.cleanup?.pruned,
								taskCount: group.cleanup?.tasks?.length, errors: group.cleanup?.errors?.slice(0, 4).map(errors),
							}));
						}
					} catch (error) { cleanup = { readError: token(record(error).code) }; }
					t.diagnostic(JSON.stringify({ mode, expected, mockCalls: mockPi.callCount(), markerPresent: fs.existsSync(marker),
						result: project(payload), status: project(status), steps: (status.steps ?? []).slice(0, 2).map(project),
						children: (payload.results ?? []).slice(0, 2).map(project), cleanup, processTerminal: project(proof) }));
				}
				assert.equal(payload.state, expected);
				assert.equal(status.state, expected);
				assert.equal(status.steps[0].status, expected);
				assert.equal(payload.success, mode === "success");
				assert.equal(mockPi.callCount(), mode === "success" ? 1 : 0);
				assert.equal(fs.existsSync(marker), mode === "success");
				assert.ok(held.parallelHandoff?.path);
				const handoff = JSON.parse(fs.readFileSync(held.parallelHandoff.path, "utf8"));
				const group = handoff.groups[0];
				if (mode === "deadline") {
					assert.equal(payload.timedOut, true);
					assert.equal(status.timedOut, true);
					assert.ok(payload.deadlineAt! <= Date.now());
					assert.equal(group.cleanup.pruned, false);
					assert.equal(group.cleanup.tasks[0].preserved, true);
					assert.equal(fs.existsSync(group.cleanup.tasks[0].path), true);
				} else {
					assert.equal(group.cleanup.state, "complete");
					assert.equal(group.cleanup.tasks.length, 1);
					assert.equal(group.cleanup.tasks[0].worktreeRemoved, true);
					assert.equal(group.cleanup.tasks[0].branchRemoved, true);
					assert.equal(fs.existsSync(group.cleanup.tasks[0].path), false);
					assert.equal(execFileSync("git", ["branch", "--list", group.cleanup.tasks[0].branch], { cwd: repo, encoding: "utf8" }).trim(), "");
				}
			} finally {
				socket?.end("release");
				if (started && !closed) { deliverStopRequest({ asyncDir, source: "test-cleanup" }); await terminal; }
				socket?.destroy();
				await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
				removeTempDir(baseDir);
				removeTempDir(repo);
			}
		});
	}

	it("does not start child work when initial async status cannot be written", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		const id = `async-status-write-fail-${Date.now().toString(36)}`;
		fs.mkdirSync(path.join(ASYNC_DIR, id, "status.json"), { recursive: true });
		mockPi.onCall({ output: "must not run" });

		const result = executeAsyncSingle(id, {
			agent: "worker",
			task: "Do not start",
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
		assert.match(result.content[0]?.text ?? "", /Failed to persist initial async status/);
		await new Promise((resolve) => setTimeout(resolve, 300));
		assert.equal(mockPi.callCount(), 0);
	});

	it("returns a tool error when an async run uses a missing cwd", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, () => {
		const id = `async-missing-cwd-${Date.now().toString(36)}`;
		const missingCwd = path.join(tempDir, "missing-cwd");

		const singleResult = executeAsyncSingle(id, {
			agent: "worker",
			task: "Do work",
			agentConfig: makeAgent("worker"),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			cwd: missingCwd,
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

		assert.equal(singleResult.isError, true);
		assert.match(singleResult.content[0]?.text ?? "", /Failed to start async run/);
		assert.match(singleResult.content[0]?.text ?? "", /cwd does not exist/);
	});

	it("returns a tool error when the async runner process cannot spawn", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, () => {
		const originalExecPath = process.execPath;
		const pathKey = process.platform === "win32" ? "Path" : "PATH";
		const originalPath = process.env[pathKey];
		process.execPath = path.join(tempDir, process.platform === "win32" ? "pi.exe" : "pi");
		process.env[pathKey] = tempDir;
		try {
			const id = `async-spawn-fail-${Date.now().toString(36)}`;
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
			assert.match(result.content[0]?.text ?? "", /async runner did not produce a pid/);
		} finally {
			process.execPath = originalExecPath;
			if (originalPath === undefined) {
				delete process.env[pathKey];
			} else {
				process.env[pathKey] = originalPath;
			}
		}
	});

	it("background publishes a structured-only terminal", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		const id = `async-structured-terminal-${Date.now().toString(36)}`;
		const callsBefore = mockPi.callCount();
		mockPi.onCall({ jsonl: [], structuredOutput: { ok: true } });

		executeAsyncSingle(id, {
			agent: "worker", task: "Return data", agentConfig: makeAgent("worker"),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
			sessionRoot: path.join(tempDir, "sessions"), maxSubagentDepth: 2,
			structuredOutputSchema: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } },
		});

		const payload = await readAsyncPayload(id);
		assert.equal(payload.success, true, payload.results[0]?.error);
		assert.deepEqual(payload.results[0]?.structuredOutput, { ok: true });
		assert.equal(mockPi.callCount(), callsBefore + 1, "settled structured completion must not continue with another turn");
	});

	for (const terminal of ["error", "aborted"] as const) {
		it(`background preserves structured evidence when a later ${terminal} terminal keeps the run failed`, { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
			const id = `async-structured-${terminal}-${Date.now().toString(36)}`;
			const terminalMessage = {
				type: "message_end",
				message: {
					role: "assistant",
					content: [],
					model: "mock/test-model",
					stopReason: terminal,
					errorMessage: terminal === "error" ? "later provider failure" : "This operation was aborted",
					usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
				},
			};
			mockPi.onCall({
				structuredOutputCapture: { ok: true },
				jsonl: [
					{ type: "tool_execution_start", toolName: "structured_output", args: { value: { ok: true } } },
					{ type: "tool_result_end", message: { role: "toolResult", toolName: "structured_output", content: [{ type: "text", text: "Structured output captured." }] } },
					{ type: "tool_execution_end", toolName: "structured_output" },
					terminalMessage,
				],
			});

			executeAsyncSingle(id, {
				agent: "worker", task: "Return data, then fail", agentConfig: makeAgent("worker"), acceptance: false,
				ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
				artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
				sessionRoot: path.join(tempDir, "sessions"), maxSubagentDepth: 2,
				structuredOutputSchema: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } },
			});

			const payload = await readAsyncPayload(id);
			// The runner publishes the result before the terminal status.
			const status = await waitForAsyncState(id, (candidate) => candidate.state !== "running" && candidate.state !== "queued");
			const child = payload.results[0]!;
			assert.equal(payload.success, false);
			assert.equal(payload.state, "failed");
			assert.equal(child.success, false);
			assert.deepEqual(child.structuredOutput, { ok: true });
			assert.ok(child.structuredOutputPath);
			assert.deepEqual(JSON.parse(fs.readFileSync(child.structuredOutputPath, "utf-8")), { ok: true });
			assert.equal(status.state, "failed");
			assert.equal(status.steps?.[0]?.status, "failed");
			assert.deepEqual(status.steps?.[0]?.structuredOutput, { ok: true });
			assert.equal(status.steps?.[0]?.structuredOutputPath, child.structuredOutputPath);
		});
	}

	it("background keeps invalid and missing structured captures absent", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		for (const capture of ["invalid", "missing"] as const) {
			const id = `async-structured-${capture}-${Date.now().toString(36)}`;
			mockPi.onCall(capture === "invalid" ? {
				jsonl: [
					{ type: "tool_execution_start", toolName: "structured_output", args: { value: { ok: "invalid" } } },
					{ type: "tool_result_end", message: { role: "toolResult", toolName: "structured_output", content: [{ type: "text", text: "Structured output validation failed." }], isError: true } },
					{ type: "tool_execution_end", toolName: "structured_output", isError: true },
					events.assistantMessage("done"),
				],
			} : { output: "done" });

			executeAsyncSingle(id, {
				agent: "worker", task: "Return data", agentConfig: makeAgent("worker"), acceptance: false,
				ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
				artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
				sessionRoot: path.join(tempDir, "sessions"), maxSubagentDepth: 2,
				structuredOutputSchema: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } },
			});

			const payload = await readAsyncPayload(id);
			const status = JSON.parse(fs.readFileSync(path.join(ASYNC_DIR, id, "status.json"), "utf-8")) as AsyncStatusPayload;
			assert.equal(payload.success, false);
			assert.equal(payload.results[0]?.structuredOutput, undefined);
			assert.equal(status.steps?.[0]?.structuredOutput, undefined);
			assert.equal(fs.existsSync(path.join(ASYNC_DIR, id, "structured-output", "output.json")), false);
		}
	});

	it("background does not abort when a steer arrives after the final stop and turn_start is delayed", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({
			jsonl: [events.assistantMessage("before steer")],
			keepAliveAfterFinalMessageMs: 15_000,
			queuedMessageTurnStartDelayMs: 1400,
			queuedMessageOutput: "after steer",
		});
		const id = `async-queued-steer-after-final-${Date.now().toString(36)}`;
		executeAsyncSingle(id, {
			agent: "worker", task: "Do work", agentConfig: makeAgent("worker"),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
			sessionRoot: path.join(tempDir, "sessions"), maxSubagentDepth: 2,
		});
		await waitForMockPiCall(mockPi, 0, 10_000);
		const scriptedFinal = path.join(mockPi.dir, "scripted-final.jsonl");
		const deadline = Date.now() + 10_000;
		while (!fs.existsSync(scriptedFinal)) {
			if (Date.now() > deadline) assert.fail("Timed out waiting for scripted final message");
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		requestAsyncSteer(path.join(ASYNC_DIR, id), { message: "Continue after the final stop.", id: "after-final", ts: Date.now() });
		const payload = await readAsyncPayload(id);
		assert.equal(payload.success, true, payload.results[0]?.error);
		assert.equal(payload.results[0]?.error, undefined);
		assert.equal(payload.results[0]?.output, "after steer");
		assert.doesNotMatch(JSON.stringify(payload), /did not settle within \d+ms after its terminal event/);
	});

	for (const type of ["turn_start", "agent_start", "auto_retry_start"]) {
		it(`background keeps resumed work alive after ${type}`, { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
			const id = `async-resumed-${type}-${Date.now().toString(36)}`;
			mockPi.onCall({
				steps: [
					{ jsonl: [events.assistantMessage("before continuation"), { type }] },
					// Queued steering/follow-up work is allowed to outlive the old final-stop grace.
					{ delay: 1400, jsonl: [events.assistantMessage("after continuation")] },
				],
			});
			executeAsyncSingle(id, {
				agent: "worker", task: "Do work", agentConfig: makeAgent("worker"),
				ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
				artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
				sessionRoot: path.join(tempDir, "sessions"), maxSubagentDepth: 2,
			});
			const payload = await readAsyncPayload(id);
			assert.equal(payload.success, true, payload.results[0]?.error);
			assert.equal(payload.results[0]?.output, "after continuation");
		});
	}

	it("background forced drain after final assistant output is cleanup success", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({
			jsonl: [events.assistantMessage("async-done-before-drain")],
			stderr: "Done after 1 turn(s). Ready for input.\n",
			keepAliveAfterFinalMessageMs: 10000,
		});

		const id = `async-final-drain-${Date.now().toString(36)}`;
		const resultPath = path.join(RESULTS_DIR, `${id}.json`);
		const sessionRoot = path.join(tempDir, "sessions");

		const start = Date.now();
		executeAsyncSingle(id, {
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

		const elapsed = Date.now() - start;
		const payload = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
		assert.ok(elapsed < 9000, `should clean up async child before the mock's natural keepalive exit, took ${elapsed}ms`);
		assert.equal(payload.success, true);
		assert.equal(payload.exitCode, 0);
		assert.equal(payload.results[0].success, true);
		assert.equal(payload.results[0].output, "async-done-before-drain");
	});

	it("background forced drain after empty terminal assistant output is cleanup success", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({
			jsonl: [events.assistantMessage("")],
			keepAliveAfterFinalMessageMs: 10000,
		});

		const id = `async-final-drain-empty-${Date.now().toString(36)}`;
		const resultPath = path.join(RESULTS_DIR, `${id}.json`);

		const start = Date.now();
		executeAsyncSingle(id, {
			agent: "scout",
			task: "Inspect something",
			agentConfig: makeAgent("scout"),
			acceptance: { level: "attested", criteria: ["Finish cleanly"] },
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
			sessionRoot: path.join(tempDir, "sessions"),
			maxSubagentDepth: 2,
		});

		const deadline = Date.now() + 10_000;
		while (!fs.existsSync(resultPath)) {
			if (Date.now() > deadline) assert.fail(`Timed out waiting for async result file: ${resultPath}`);
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		const elapsed = Date.now() - start;
		const payload = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
		assert.ok(elapsed < 9000, `should clean up async child before the mock's natural keepalive exit, took ${elapsed}ms`);
		assert.equal(payload.success, true);
		assert.equal(payload.exitCode, 0);
		assert.equal(payload.results[0].success, true);
		assert.equal(payload.results[0].output, "");
	});

	it("background final-drain cleanup preserves explicit assistant errors", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({
			jsonl: [{
				type: "message_end",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "failed" }],
					model: "mock/test-model",
					stopReason: "stop",
					errorMessage: "provider exploded",
					usage: { input: 100, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0.001 } },
				},
			}],
			keepAliveAfterFinalMessageMs: 10000,
		});

		const id = `async-final-drain-error-${Date.now().toString(36)}`;
		const resultPath = path.join(RESULTS_DIR, `${id}.json`);

		executeAsyncSingle(id, {
			agent: "worker",
			task: "Do work",
			agentConfig: makeAgent("worker"),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
			sessionRoot: path.join(tempDir, "sessions"),
			maxSubagentDepth: 2,
		});

		const deadline = Date.now() + 10_000;
		while (!fs.existsSync(resultPath)) {
			if (Date.now() > deadline) assert.fail(`Timed out waiting for async result file: ${resultPath}`);
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		const payload = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
		assert.equal(payload.success, false);
		assert.equal(payload.exitCode, 1);
		assert.equal(payload.results[0].success, false);
		assert.equal(payload.results[0].error, "provider exploded");
	});

	it("reports terminal abort before a missing file-only handoff after mutation", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		const partialOutput = "I’ll inspect the retained candidate before changing it.";
		const repo = createRepo("pi-subagents-missing-handoff-partial-");
		const outputPath = path.join(repo, "missing-challenge-report.md");
		mockPi.onCall({
			jsonl: [
				events.assistantMessage(partialOutput),
				{
					type: "message_end",
					message: {
						role: "assistant",
						content: [],
						model: "mock/test-model",
						stopReason: "aborted",
						usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
					},
				},
			],
			writeFiles: [{ path: "input.md", content: "changed by retained child\n" }],
		});

		const task = [
			"You are reviving a previous subagent conversation.",
			"",
			"Original run: source-run",
			"Original agent: worker",
			"Original session file: /tmp/source-session.jsonl",
			"",
			"Use the stored session context as background. Answer the orchestrator's follow-up below. Do not assume the original child session is still running.",
			"",
			"Follow-up:",
			"Implementation challenge pass 1 for the accepted candidate. Reconsider it and implement any better current-scope change.",
		].join("\n");
		const id = `async-missing-handoff-guard-${Date.now().toString(36)}`;
		try {
			executeAsyncSingle(id, {
				agent: "worker",
				task,
				agentConfig: makeAgent("worker"),
				ctx: { pi: { events: { emit() {} } }, cwd: repo, currentSessionId: "session-1" },
				artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
				sessionRoot: path.join(tempDir, "sessions"),
				output: outputPath,
				outputMode: "file-only",
				maxSubagentDepth: 2,
			});

			const resultPath = await waitForAsyncResultFile(id);
			const payload = JSON.parse(fs.readFileSync(resultPath, "utf-8")) as AsyncResultPayload;
			const child = payload.results[0];
			const diagnostic = child?.error ?? "";
			assert.equal(payload.success, false);
			assert.equal(payload.state, "partial");
			assert.equal(child?.success, false);
			assert.match(diagnostic, /^Subagent produced no output after terminal assistant stopReason "aborted"\./);
			assert.match(diagnostic, new RegExp(`Required file-only output was not produced: ${escapeRegExp(outputPath)}`));
			assert.equal(child?.effects?.fileMutation?.status, "observed");
			assert.equal(child?.effects?.fileMutation?.attempted, true);
			assert.deepEqual(child?.effects?.fileMutation?.evidence?.changedFiles, ["input.md"]);
			assert.equal(child?.effects?.settlementDiagnostic?.requiredOutput?.missing, true);
			assert.equal(fs.existsSync(outputPath), false);

			const status = await waitForAsyncState(id, (candidate) => candidate.state === "partial");
			assert.equal(status.activityState, "needs_attention");
			assert.equal(status.steps?.[0]?.activityState, "needs_attention");
			assert.equal(status.steps?.[0]?.error, diagnostic);
		} finally {
			removeTempDir(repo);
		}
	});

	it("preserves terminal empty-output diagnostics after useful child work", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		const partialOutput = "I’ll inspect the retained candidate before changing it.";
		const outputPath = path.join(tempDir, "missing-aborted-report.md");
		mockPi.onCall({
			jsonl: [
				events.toolStart("read", { path: "src/index.ts" }),
				events.toolEnd("read"),
				events.toolResult("read", "file contents"),
				events.assistantMessage(partialOutput),
				{
					type: "message_end",
					message: {
						role: "assistant",
						content: [],
						model: "mock/test-model",
						stopReason: "aborted",
						usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
					},
				},
			],
			exitCode: 0,
		});

		const id = `async-aborted-empty-handoff-${Date.now().toString(36)}`;
		executeAsyncSingle(id, {
			agent: "worker",
			task: "Implement the approved file changes",
			agentConfig: makeAgent("worker"),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
			sessionRoot: path.join(tempDir, "sessions"),
			output: outputPath,
			outputMode: "file-only",
			maxSubagentDepth: 2,
		});

		const resultPath = await waitForAsyncResultFile(id);
		const payload = JSON.parse(fs.readFileSync(resultPath, "utf-8")) as AsyncResultPayload;
		const child = payload.results[0];
		const diagnostic = child?.error ?? "";
		assert.equal(payload.success, false);
		assert.equal(child?.success, false);
		assert.match(diagnostic, /^Subagent produced no output after terminal assistant stopReason "aborted"\./);
		assert.match(diagnostic, /Required file-only output was not produced/);
		assert.equal(child?.effects?.settlementDiagnostic?.requiredOutput?.missing, true);
		assert.equal(child?.effects?.settlementDiagnostic?.finalTextPresent, true);
		assert.equal(fs.existsSync(outputPath), false);

	});

	it("reports bounded compaction failure context when file-only output is missing", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		const terminalError = `This operation was aborted\n${"x".repeat(12_000)}`;
		mockPi.onCall({
			jsonl: [
				events.toolStart("read", { path: "src/index.ts" }),
				events.toolEnd("read"),
				events.toolResult("read", "file contents"),
				{ type: "compaction_start" },
				{
					type: "message_end",
					message: {
						role: "assistant",
						content: [],
						model: "mock/test-model",
						stopReason: "error",
						errorMessage: terminalError,
						usage: { input: 100, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0.001 } },
					},
				},
				{ type: "agent_settled" },
			],
			exitCode: 0,
		});

		const id = `async-compaction-file-only-error-${Date.now().toString(36)}`;
		const asyncDir = path.join(ASYNC_DIR, id);
		const outputPath = path.join(tempDir, "missing-oracle-report.md");
		executeAsyncSingle(id, {
			agent: "oracle",
			task: "Write a report",
			agentConfig: makeAgent("oracle"),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
			sessionRoot: path.join(tempDir, "sessions"),
			output: outputPath,
			outputMode: "file-only",
			maxSubagentDepth: 2,
		});

		const resultPath = await waitForAsyncResultFile(id);
		const payload = JSON.parse(fs.readFileSync(resultPath, "utf-8")) as AsyncResultPayload;
		const child = payload.results[0] as (AsyncResultPayload["results"][number] & Record<string, unknown>) | undefined;
		const diagnostic = child?.error ?? "";
		assert.equal(payload.success, false);
		assert.equal(child?.success, false);
		assert.match(diagnostic, /^This operation was aborted/);
		assert.match(diagnostic, /failure followed session compaction and agent settlement/);
		assert.match(diagnostic, /Required file-only output was not produced/);
		assert.ok(diagnostic.length <= 8_192);
		assert.equal(fs.existsSync(outputPath), false);
		assert.equal(child?.output, "");
		assert.equal("savedOutputPath" in (child ?? {}), false);
		assert.equal("outputReference" in (child ?? {}), false);
		assert.equal(payload.summary, `oracle:\n${diagnostic}`);
		const status = await waitForAsyncState(id, (candidate) => candidate.state === "failed");
		assert.equal(status.steps?.[0]?.exitCode, 1);
		assert.equal(status.steps?.[0]?.error, diagnostic);
		const logPath = path.join(asyncDir, `subagent-log-${id}.md`);
		const deadline = Date.now() + 10_000;
		while (!fs.existsSync(logPath)) {
			if (Date.now() > deadline) assert.fail(`Timed out waiting for async run log: ${logPath}`);
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		assert.ok(fs.readFileSync(logPath, "utf-8").includes(`## Summary\noracle:\n${diagnostic}`));
	});

	it("notifies once for each distinct long-open background command", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({ steps: [
			{ jsonl: [{ type: "tool_execution_start", toolCallId: "bash-first", toolName: "bash", args: { command: "sleep 2" } }] },
			{ delay: 2200, jsonl: [{ type: "tool_execution_end", toolCallId: "bash-first", toolName: "bash" }, events.toolResult("bash", "done")] },
			{ jsonl: [{ type: "tool_execution_start", toolCallId: "bash-second", toolName: "bash", args: { command: "sleep 2" } }] },
			{ delay: 2200, jsonl: [{ type: "tool_execution_end", toolCallId: "bash-second", toolName: "bash" }, events.toolResult("bash", "done"), events.assistantMessage("Done")] },
		] });
		const id = `async-sequential-attention-${Date.now().toString(36)}`;
		executeAsyncSingle(id, {
			agent: "worker", task: "Run commands", agentConfig: makeAgent("worker"),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
			sessionRoot: path.join(tempDir, "sessions"), maxSubagentDepth: 2,
			controlConfig: { enabled: true, needsAttentionAfterMs: 999_999, activeNoticeAfterMs: 100, failedToolAttemptsBeforeAttention: 3, notifyOn: ["needs_attention"], notifyChannels: ["event", "async"] },
		});
		const result = await readAsyncPayload(id);
		assert.equal(result.success, true);
		const rows = fs.readFileSync(path.join(ASYNC_DIR, id, "events.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
		const attention = rows.filter((row) => row.type === "subagent.control" && row.event?.reason === "tool_open_threshold").map((row) => row.event.toolCallId);
		assert.deepEqual(attention, ["bash-first", "bash-second"]);
	});

	it("background runs emit active-long-running control events from child turns", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({
			steps: [
				{ jsonl: [events.assistantMessage("still working")] },
				{ delay: 2_000, jsonl: [events.assistantMessage("done")] },
			],
		});

		const id = `async-active-long-${Date.now().toString(36)}`;
		const asyncDir = path.join(ASYNC_DIR, id);
		const eventsPath = path.join(asyncDir, "events.jsonl");
		const resultPath = path.join(RESULTS_DIR, `${id}.json`);

		executeAsyncSingle(id, {
			agent: "scout",
			task: "Investigate behavior",
			agentConfig: makeAgent("scout"),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
			sessionRoot: path.join(tempDir, "sessions"),
			maxSubagentDepth: 2,
			controlConfig: {
				enabled: true,
				needsAttentionAfterMs: 999_999,
				activeNoticeAfterTurns: 1,
				activeNoticeAfterMs: 999_999,
				activeNoticeAfterTokens: 999_999,
				failedToolAttemptsBeforeAttention: 3,
				notifyOn: ["active_long_running", "needs_attention"],
				notifyChannels: ["event", "async"],
			},
		});

		const statusPath = path.join(asyncDir, "status.json");
		const deadline = Date.now() + 10_000;
		let eventText = "";
		let statusDuringEvent: AsyncStatusPayload | undefined;
		while (Date.now() < deadline) {
			if (fs.existsSync(eventsPath)) {
				eventText = fs.readFileSync(eventsPath, "utf-8");
			}
			if (eventText.includes('"type":"active_long_running"') && fs.existsSync(statusPath)) {
				const status = JSON.parse(fs.readFileSync(statusPath, "utf-8")) as AsyncStatusPayload;
				if (status.activityState === "active_long_running" && status.steps?.[0]?.activityState === "active_long_running") {
					statusDuringEvent = status;
					break;
				}
			}
			if (eventText.includes('"type":"active_long_running"') && fs.existsSync(resultPath)) {
				assert.fail("run completed before status.json exposed active_long_running");
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		assert.match(eventText, /"type":"active_long_running"/);
		assert.match(eventText, /"reason":"turn_threshold"/);
		assert.ok(statusDuringEvent, "expected status.json to expose active_long_running while the run is still active");
		assert.equal(statusDuringEvent.activityState, "active_long_running");
		assert.equal(statusDuringEvent.steps?.[0]?.activityState, "active_long_running");

		const doneDeadline = Date.now() + 10_000;
		while (!fs.existsSync(resultPath)) {
			if (Date.now() > doneDeadline) assert.fail(`Timed out waiting for async result file: ${resultPath}`);
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	});

	it("does not flag a delayed active tool as idle attention", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({
			steps: [
				{ jsonl: [events.toolStart("bash", { command: "sleep 2" })] },
				{ delay: 2_500, jsonl: [events.toolEnd("bash"), events.toolResult("bash", "done")] },
				{ jsonl: [events.assistantMessage("Done")] },
			],
		});

		const id = `async-delayed-tool-attention-${Date.now().toString(36)}`;
		const asyncDir = path.join(ASYNC_DIR, id);
		const eventsPath = path.join(asyncDir, "events.jsonl");
		const resultPath = path.join(RESULTS_DIR, `${id}.json`);
		executeAsyncSingle(id, {
			agent: "worker",
			task: "Run the command",
			agentConfig: makeAgent("worker"),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
			sessionRoot: path.join(tempDir, "sessions"),
			maxSubagentDepth: 2,
			controlConfig: {
				enabled: true,
				needsAttentionAfterMs: 200,
				activeNoticeAfterMs: 999_999,
				failedToolAttemptsBeforeAttention: 3,
				notifyOn: ["active_long_running", "needs_attention"],
				notifyChannels: ["event", "async"],
			},
		});

		const deadline = Date.now() + 10_000;
		let statusDuringTool: AsyncStatusPayload | undefined;
		while (Date.now() < deadline && !fs.existsSync(resultPath)) {
			if (fs.existsSync(asyncDir) && fs.existsSync(path.join(asyncDir, "status.json"))) {
				const status = JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf-8")) as AsyncStatusPayload;
				const toolStartedAt = status.steps?.[0]?.currentToolStartedAt;
				if (status.currentTool === "bash" && status.steps?.[0]?.currentTool === "bash" && toolStartedAt && Date.now() - toolStartedAt >= 1_500) {
					statusDuringTool = status;
					break;
				}
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		assert.ok(statusDuringTool, "expected status.json to expose the active tool");
		assert.equal(statusDuringTool?.activityState, undefined);
		assert.equal(statusDuringTool?.steps?.[0]?.activityState, undefined);
		const eventText = fs.existsSync(eventsPath) ? fs.readFileSync(eventsPath, "utf-8") : "";
		assert.doesNotMatch(eventText, /"type":"needs_attention"/);
		await waitForAsyncResultFile(id);
		const payload = JSON.parse(fs.readFileSync(resultPath, "utf-8")) as AsyncResultPayload;
		assert.equal(payload.success, true);
	});

	it("background open-tool attention survives an overlapping quick tool", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({
			steps: [
				{ jsonl: [{ type: "tool_execution_start", toolCallId: "bash-1", toolName: "bash", args: { command: "sleep 2" } }] },
				{ delay: 50, jsonl: [
					{ type: "tool_execution_start", toolCallId: "read-1", toolName: "read", args: { path: "README.md" } },
					{ type: "tool_execution_end", toolCallId: "read-1", toolName: "read" },
				] },
				{ delay: 2_000, jsonl: [
					{ type: "tool_execution_end", toolCallId: "bash-1", toolName: "bash" },
					events.toolResult("bash", "done"),
					events.assistantMessage("Done"),
				] },
			],
		});

		const id = `async-overlap-tool-attention-${Date.now().toString(36)}`;
		const asyncDir = path.join(ASYNC_DIR, id);
		const eventsPath = path.join(asyncDir, "events.jsonl");
		const statusPath = path.join(asyncDir, "status.json");
		const resultPath = path.join(RESULTS_DIR, `${id}.json`);
		executeAsyncSingle(id, {
			agent: "worker",
			task: "Run the command",
			agentConfig: makeAgent("worker"),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
			sessionRoot: path.join(tempDir, "sessions"),
			maxSubagentDepth: 2,
			controlConfig: {
				enabled: true,
				needsAttentionAfterMs: 999_999,
				activeNoticeAfterMs: 100,
				failedToolAttemptsBeforeAttention: 3,
				notifyOn: ["needs_attention"],
				notifyChannels: ["event", "async"],
			},
		});

		const deadline = Date.now() + 10_000;
		let eventText = "";
		let statusDuringEvent: AsyncStatusPayload | undefined;
		while (Date.now() < deadline) {
			if (fs.existsSync(eventsPath)) eventText = fs.readFileSync(eventsPath, "utf-8");
			if (eventText.includes('"reason":"tool_open_threshold"') && fs.existsSync(statusPath)) {
				const status = JSON.parse(fs.readFileSync(statusPath, "utf-8")) as AsyncStatusPayload;
				if (status.activityState === "needs_attention" && status.steps?.[0]?.activityState === "needs_attention") {
					statusDuringEvent = status;
					break;
				}
			}
			if (eventText.includes('"reason":"tool_open_threshold"') && fs.existsSync(resultPath)) {
				assert.fail("run completed before status.json exposed overlapping tool attention");
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		assert.match(eventText, /"type":"needs_attention"/);
		assert.match(eventText, /"reason":"tool_open_threshold"/);
		assert.match(eventText, /"currentTool":"bash"/);
		assert.ok(statusDuringEvent, "expected status.json to expose overlapping tool attention while the run is active");
		assert.equal(statusDuringEvent.currentTool, "bash");
		assert.equal(statusDuringEvent.steps?.[0]?.currentTool, "bash");
		await waitForAsyncResultFile(id);
	});

	it("background open-tool attention survives a supervisor request that ends first", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		const id = `async-supervisor-then-tool-attention-${Date.now().toString(36)}`;
		const supervisorReleasePath = path.join(tempDir, `${id}.supervisor`);
		const finalReleasePath = path.join(tempDir, `${id}.final`);
		mockPi.onCall({ steps: [
			{ jsonl: [
				{ type: "tool_execution_start", toolCallId: "bash-1", toolName: "bash", args: { command: "sleep 5" } },
				{ type: "tool_execution_start", toolCallId: "decision", toolName: "contact_supervisor", args: { reason: "need_decision", message: "Choose" } },
			] },
			{ waitForPath: supervisorReleasePath, jsonl: [{ type: "tool_execution_end", toolCallId: "decision", toolName: "contact_supervisor" }] },
			{ waitForPath: finalReleasePath, jsonl: [{ type: "tool_execution_end", toolCallId: "bash-1", toolName: "bash" }, events.toolResult("bash", "done"), events.assistantMessage("Done")] },
		] });
		const eventsPath = path.join(ASYNC_DIR, id, "events.jsonl");
		const statusPath = path.join(ASYNC_DIR, id, "status.json");
		executeAsyncSingle(id, {
			agent: "worker", task: "Run the command", agentConfig: makeAgent("worker"),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
			sessionRoot: path.join(tempDir, "sessions"), maxSubagentDepth: 2,
			controlConfig: { enabled: true, needsAttentionAfterMs: 999_999, activeNoticeAfterMs: 100, failedToolAttemptsBeforeAttention: 3, notifyOn: ["needs_attention"], notifyChannels: ["event", "async"] },
		});
		try {
			const deadline = Date.now() + 10_000;
			while (Date.now() < deadline && !(fs.existsSync(eventsPath) && fs.readFileSync(eventsPath, "utf-8").includes('"reason":"tool_open_threshold"'))) {
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			assert.match(fs.readFileSync(eventsPath, "utf-8"), /"reason":"tool_open_threshold"/);
			fs.writeFileSync(supervisorReleasePath, "");
			let status: AsyncStatusPayload | undefined;
			while (Date.now() < deadline) {
				status = JSON.parse(fs.readFileSync(statusPath, "utf-8")) as AsyncStatusPayload;
				// The supervisor call's end is in recentTools only after its cleanup ran.
				if (status.steps?.[0]?.recentTools?.some((tool) => tool.tool === "contact_supervisor")) break;
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			assert.ok(status?.steps?.[0]?.recentTools?.some((tool) => tool.tool === "contact_supervisor"), "expected the supervisor call to have ended");
			assert.equal(status?.currentTool, "bash");
			assert.equal(status?.steps?.[0]?.activityState, "needs_attention");
			assert.equal(status?.activityState, "needs_attention");
		} finally {
			fs.writeFileSync(supervisorReleasePath, "");
			fs.writeFileSync(finalReleasePath, "");
			await waitForAsyncResultFile(id);
		}
	});

	it("bg_wait wakes when an async child is waiting on contact_supervisor", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		const id = `async-supervisor-attention-${Date.now().toString(36)}`;
		const replyReleasePath = path.join(tempDir, `${id}.reply`);
		const finalReleasePath = path.join(tempDir, `${id}.final`);
		mockPi.onCall({
			steps: [
				{ jsonl: [events.toolStart("contact_supervisor", { reason: "need_decision", message: "Need a decision" })] },
				{ waitForPath: replyReleasePath, jsonl: [events.toolEnd("contact_supervisor"), events.toolResult("contact_supervisor", "**Reply from supervisor:**\nProceed")] },
				{ waitForPath: finalReleasePath, jsonl: [events.assistantMessage("Done")] },
			],
		});

		const asyncDir = path.join(ASYNC_DIR, id);
		const eventsPath = path.join(asyncDir, "events.jsonl");
		const resultPath = path.join(RESULTS_DIR, `${id}.json`);
		const statusPath = path.join(asyncDir, "status.json");
		executeAsyncSingle(id, {
			agent: "worker",
			task: "Ask the supervisor for a blocking decision",
			agentConfig: makeAgent("worker"),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
			sessionRoot: path.join(tempDir, "sessions"),
			maxSubagentDepth: 2,
			controlConfig: {
				enabled: true,
				needsAttentionAfterMs: 999_999,
				activeNoticeAfterMs: 999_999,
				failedToolAttemptsBeforeAttention: 3,
				notifyOn: ["active_long_running", "needs_attention"],
				notifyChannels: ["event", "async"],
			},
		});

		const releaseMockChild = () => {
			if (!fs.existsSync(replyReleasePath)) fs.writeFileSync(replyReleasePath, "release", "utf-8");
			if (!fs.existsSync(finalReleasePath)) fs.writeFileSync(finalReleasePath, "release", "utf-8");
		};
		const releaseSupervisorReply = () => {
			if (!fs.existsSync(replyReleasePath)) fs.writeFileSync(replyReleasePath, "release", "utf-8");
		};
		try {
			const attentionDeadline = Date.now() + 10_000;
			let statusDuringAttention: AsyncStatusPayload | undefined;
			while (Date.now() < attentionDeadline && !fs.existsSync(resultPath)) {
				if (fs.existsSync(statusPath)) {
					const nextStatus = JSON.parse(fs.readFileSync(statusPath, "utf-8")) as AsyncStatusPayload;
					if (nextStatus.currentTool === "contact_supervisor" && nextStatus.activityState === "needs_attention") {
						statusDuringAttention = nextStatus;
						break;
					}
				}
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
			assert.ok(statusDuringAttention, "expected status.json to expose the blocking supervisor request");

			try {
				const waitResult = await waitForSubagents({ id, timeoutMs: 3_500 }, undefined, {
					state: { currentSessionId: "session-1", foregroundRuns: new Map(), asyncJobs: new Map(), cleanupTimers: new Map(), resultFileCoalescer: new Map() },
					pollIntervalMs: 100,
					events: createEventBus(),
				});
				const waitText = waitResult.content[0]?.text ?? "";
				assert.equal(waitResult.isError, undefined);
				assert.match(waitText, /attention required/i);
				assert.match(waitText, new RegExp(id));
				assert.match(waitText, /intercom\(\{ action: "pending" \}\)/);
				assert.equal(fs.existsSync(resultPath), false, "wait should return before the child completes");
			} finally {
				releaseSupervisorReply();
			}

			const eventText = fs.existsSync(eventsPath) ? fs.readFileSync(eventsPath, "utf-8") : "";
			assert.match(eventText, /"type":"needs_attention"/);
			assert.match(eventText, /"reason":"supervisor_request"/);
			assert.equal(statusDuringAttention.activityState, "needs_attention");
			assert.equal(statusDuringAttention.steps?.[0]?.activityState, "needs_attention");
			assert.equal(statusDuringAttention.currentTool, "contact_supervisor");
			assert.equal(statusDuringAttention.steps?.[0]?.currentTool, "contact_supervisor");

			const clearDeadline = Date.now() + 10_000;
			let statusAfterReply: AsyncStatusPayload | undefined;
			while (Date.now() < clearDeadline && !fs.existsSync(resultPath)) {
				const nextStatus = JSON.parse(fs.readFileSync(statusPath, "utf-8")) as AsyncStatusPayload;
				if (nextStatus.state === "running" && !nextStatus.currentTool && !nextStatus.steps?.[0]?.currentTool) {
					statusAfterReply = nextStatus;
					break;
				}
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
			assert.ok(statusAfterReply, "expected the child to keep running after the supervisor reply");
			assert.equal(statusAfterReply.activityState, undefined);
			assert.equal(statusAfterReply.steps?.[0]?.activityState, undefined);

			fs.writeFileSync(finalReleasePath, "release", "utf-8");
			await waitForAsyncResultFile(id);
		} finally {
			releaseMockChild();
		}
	});

	it("background runs escalate repeated mutating tool failures", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({
			steps: [
				{ jsonl: [events.toolStart("edit", { path: "src/runs/background/subagent-runner.ts" }), events.toolEnd("edit"), events.toolResult("edit", "No exact match found for subagent-runner.ts", true)] },
				{ jsonl: [events.toolStart("edit", { path: "src/runs/background/subagent-runner.ts" }), events.toolEnd("edit"), events.toolResult("edit", "No exact match found for subagent-runner.ts", true)] },
				{ jsonl: [events.toolStart("edit", { path: "src/runs/background/subagent-runner.ts" }), events.toolEnd("edit"), events.toolResult("edit", "No exact match found for subagent-runner.ts", true)] },
				{ delay: 2_000, jsonl: [events.assistantMessage("I need another attempt.")] },
			],
		});

		const id = `async-tool-failures-${Date.now().toString(36)}`;
		const asyncDir = path.join(ASYNC_DIR, id);
		const eventsPath = path.join(asyncDir, "events.jsonl");
		const resultPath = path.join(RESULTS_DIR, `${id}.json`);

		executeAsyncSingle(id, {
			agent: "worker",
			task: "Implement the approved fixes",
			agentConfig: makeAgent("worker"),
			ctx: { pi: { events: { emit() {} } }, cwd: tempDir, currentSessionId: "session-1" },
			artifactConfig: { enabled: false, includeInput: false, includeOutput: false, includeJsonl: false, includeMetadata: false, cleanupDays: 7 },
			sessionRoot: path.join(tempDir, "sessions"),
			maxSubagentDepth: 2,
			controlConfig: {
				enabled: true,
				needsAttentionAfterMs: 999_999,
				activeNoticeAfterTurns: 999_999,
				activeNoticeAfterMs: 999_999,
				activeNoticeAfterTokens: 999_999,
				failedToolAttemptsBeforeAttention: 3,
				notifyOn: ["active_long_running", "needs_attention"],
				notifyChannels: ["event", "async"],
			},
		});

		const statusPath = path.join(asyncDir, "status.json");
		const deadline = Date.now() + 10_000;
		let eventText = "";
		let statusDuringEvent: AsyncStatusPayload | undefined;
		while (Date.now() < deadline) {
			if (fs.existsSync(eventsPath)) {
				eventText = fs.readFileSync(eventsPath, "utf-8");
			}
			if (eventText.includes('"reason":"tool_failures"') && fs.existsSync(statusPath)) {
				const status = JSON.parse(fs.readFileSync(statusPath, "utf-8")) as AsyncStatusPayload;
				if (status.activityState === "needs_attention" && status.steps?.[0]?.activityState === "needs_attention") {
					statusDuringEvent = status;
					break;
				}
			}
			if (eventText.includes('"reason":"tool_failures"') && fs.existsSync(resultPath)) {
				assert.fail("run completed before status.json exposed needs_attention");
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		assert.match(eventText, /"type":"needs_attention"/);
		assert.match(eventText, /"reason":"tool_failures"/);
		assert.match(eventText, /subagent-runner\.ts/);
		assert.ok(statusDuringEvent, "expected status.json to expose needs_attention while the run is still active");
		assert.equal(statusDuringEvent.activityState, "needs_attention");
		assert.equal(statusDuringEvent.steps?.[0]?.activityState, "needs_attention");

		const doneDeadline = Date.now() + 10_000;
		while (!fs.existsSync(resultPath)) {
			if (Date.now() > doneDeadline) assert.fail(`Timed out waiting for async result file: ${resultPath}`);
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	});

	it("background event logs drop noisy message updates and cap child diagnostics", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		const previousMaxBytes = process.env.PI_SUBAGENT_ASYNC_EVENTS_MAX_BYTES;
		process.env.PI_SUBAGENT_ASYNC_EVENTS_MAX_BYTES = "1100";
		try {
			mockPi.onCall({
				steps: [
					{
						jsonl: [
							{
								type: "message_update",
								assistantMessageEvent: {
									type: "thinking_delta",
									delta: "NOISY_PARTIAL_DELTA",
									partial: { role: "assistant", content: [{ type: "text", text: "NOISY_PARTIAL_SNAPSHOT".repeat(200) }] },
								},
								message: { role: "assistant", content: [{ type: "text", text: "NOISY_PARTIAL_MESSAGE".repeat(200) }] },
							},
							events.toolStart("bash", { command: `echo ${"BIG_COMMAND_PAYLOAD".repeat(200)}` }),
							events.assistantMessage("Done after noisy stream"),
						],
					},
				],
			});

			const id = `async-noisy-events-${Date.now().toString(36)}`;
			const asyncDir = path.join(ASYNC_DIR, id);
			const sessionRoot = path.join(tempDir, "sessions");

			executeAsyncSingle(id, {
				agent: "worker",
				task: "Stream noisy diagnostics",
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

			const resultPath = await waitForAsyncResultFile(id, 10_000);
			const payload = JSON.parse(fs.readFileSync(resultPath, "utf-8")) as AsyncResultPayload;
			assert.equal(payload.success, true);
			assert.equal(payload.results[0]?.output, "Done after noisy stream");

			const eventsText = fs.readFileSync(path.join(asyncDir, "events.jsonl"), "utf-8");
			assert.doesNotMatch(eventsText, /"type":"message_update"/);
			assert.doesNotMatch(eventsText, /NOISY_PARTIAL_/);
			assert.doesNotMatch(eventsText, /BIG_COMMAND_PAYLOAD/);
			assert.match(eventsText, /"type":"subagent\.events\.truncated"/);
			assert.match(eventsText, /"droppedEventType":"tool_execution_start"/);
		} finally {
			if (previousMaxBytes === undefined) delete process.env.PI_SUBAGENT_ASYNC_EVENTS_MAX_BYTES;
			else process.env.PI_SUBAGENT_ASYNC_EVENTS_MAX_BYTES = previousMaxBytes;
		}
	});

	it("background runs stream child events and live output while active", { skip: !isAsyncAvailable() ? "jiti not available" : undefined }, async () => {
		mockPi.onCall({
			steps: [
				{ delay: 200, jsonl: [events.toolStart("bash", { command: "ls" })] },
				{ delay: 600, jsonl: [events.toolEnd("bash"), events.toolResult("bash", "file-a\nfile-b")] },
				{ delay: 600, jsonl: [events.assistantMessage("Done streaming")], stderr: "warning: mock stderr\n" },
			],
		});

		const id = `async-stream-${Date.now().toString(36)}`;
		const asyncDir = path.join(ASYNC_DIR, id);
		const eventsPath = path.join(asyncDir, "events.jsonl");
		const outputPath = path.join(asyncDir, "output-0.log");
		const resultPath = path.join(RESULTS_DIR, `${id}.json`);
		const sessionRoot = path.join(tempDir, "sessions");

		executeAsyncSingle(id, {
			agent: "worker",
			task: "Stream detailed progress",
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

		const liveDeadline = Date.now() + 10_000;
		let sawChildEvent = false;
		let sawLiveOutput = false;
		while (Date.now() < liveDeadline && (!sawChildEvent || !sawLiveOutput)) {
			if (fs.existsSync(eventsPath)) {
				const content = fs.readFileSync(eventsPath, "utf-8");
				sawChildEvent = content.includes('"type":"tool_execution_start"')
					&& content.includes('"subagentSource":"child"');
			}
			if (fs.existsSync(outputPath)) {
				const content = fs.readFileSync(outputPath, "utf-8");
				sawLiveOutput = content.includes("bash: ls") || content.includes("file-a") || content.includes("warning: mock stderr");
			}
			if (sawChildEvent && sawLiveOutput) break;
			assert.equal(fs.existsSync(resultPath), false, "run finished before live observability was written");
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		assert.equal(sawChildEvent, true, "expected child JSON events to be streamed into events.jsonl");
		assert.equal(sawLiveOutput, true, "expected output-0.log to receive live child output");

		const doneDeadline = Date.now() + 10_000;
		while (!fs.existsSync(resultPath)) {
			if (Date.now() > doneDeadline) {
				assert.fail(`Timed out waiting for async result file: ${resultPath}`);
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		const payload = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
		assert.equal(payload.success, true);
		assert.equal(payload.results[0].output, "Done streaming");

		const status = JSON.parse(fs.readFileSync(path.join(asyncDir, "status.json"), "utf-8"));
		assert.deepEqual(status.steps[0].recentTools.map((tool: { tool: string; args: string }) => ({ tool: tool.tool, args: tool.args })), [{ tool: "bash", args: "ls" }]);
		assert.deepEqual(status.steps[0].recentOutput, ["file-a", "file-b", "Done streaming"]);
	});
});
