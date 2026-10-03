import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";

const script = String.raw`
	const handlers = new Map();
	const errors = [];
	const sent = [];
	const fs = await import("node:fs");
	const os = await import("node:os");
	const path = await import("node:path");
	const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agent-end-drain-"));
	const hasOwner = process.env.PI_SUBAGENTS_TEST_NO_OWNER !== "1";
	console.error = (...args) => errors.push(args.map((value) => value instanceof Error ? value.message : String(value)).join(" "));
	const { default: registerSubagentExtension } = await import("./src/extension/index.ts");
	const { createEventBus } = await import("@earendil-works/pi-coding-agent");
	const { registerBackgroundWorkProvider } = await import("./src/runs/background/background-work.ts");
	const events = createEventBus();
	const pi = new Proxy({
		events,
		on(name, handler) { const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list); },
		registerTool() {}, registerCommand() {}, registerShortcut() {}, registerMessageRenderer() {}, getSessionName() {},
		sendMessage(message, options) { sent.push({ message, options }); },
	}, { get(target, property) { return property in target ? target[property] : () => undefined; } });
	const ctx = {
		cwd: projectRoot, hasUI: false, model: undefined,
		ui: { setWidget() {}, requestRender() {}, theme: { fg(_name, text) { return text; }, bg(_name, text) { return text; }, bold(text) { return text; } } },
		sessionManager: {
			getSessionId() { return "agent-end-drain-session"; },
			getSessionFile() { return null; },
			getEntries() { return []; },
		},
		modelRegistry: { getAvailable() { return []; } },
	};
	registerSubagentExtension(pi);
	if (hasOwner) for (const handler of handlers.get("session_start") ?? []) await handler({ reason: "startup" }, ctx);
	const providerError = new Error("synthetic drain failure");
	const dispose = registerBackgroundWorkProvider({
		name: "agent-end-drain-test",
		listActiveWork() {
			if (process.env.PI_SUBAGENTS_TEST_DRAIN_FAILURE === "1") throw providerError;
			return [];
		},
	});
	let rejected = null;
	let preservedCause = false;
	try {
		for (const handler of handlers.get("agent_end") ?? []) {
			await handler({ type: "agent_end", messages: [], willRetry: false }, ctx);
		}
	} catch (error) {
		rejected = error instanceof Error ? error.message : String(error);
		preservedCause = error instanceof Error && error.cause === providerError;
	}
	dispose();
	for (const handler of handlers.get("session_shutdown") ?? []) await handler({ reason: "quit" }, ctx);
	fs.rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
	process.stdout.write(JSON.stringify({ rejected, preservedCause, errors, sent }));
`;

describe("headless agent_end auto-drain", () => {
	for (const scenario of [
		{ name: "preserves a failed drain rejection", failedDrain: true, hasOwner: true },
		{ name: "completes a successful drain", failedDrain: false, hasOwner: true },
		{ name: "preserves the drain rejection when no session identity exists", failedDrain: false, hasOwner: false },
	]) {
		it(scenario.name, () => {
			const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agent-end-fixture-"));
			try {
				const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "--eval", script], {
					cwd: process.cwd(),
					encoding: "utf-8",
					env: {
						...process.env,
						HOME: path.join(root, "home"), USERPROFILE: path.join(root, "home"),
						PI_CODING_AGENT_DIR: path.join(root, "agent"),
						TMPDIR: root, TMP: root, TEMP: root,
						PI_SUBAGENT_CHILD: undefined,
						PI_SUBAGENTS_TEST_DRAIN_FAILURE: scenario.failedDrain ? "1" : "0",
						PI_SUBAGENTS_TEST_NO_OWNER: scenario.hasOwner ? "0" : "1",
					},
					timeout: 10_000,
				});
				assert.equal(result.status, 0, result.stderr);
				const payload = JSON.parse(result.stdout) as {
					rejected: string | null;
					preservedCause: boolean;
					errors: string[];
					sent: unknown[];
				};
				assert.equal(payload.rejected, !scenario.hasOwner
					? "Cannot auto-drain background work without an active session identity."
					: scenario.failedDrain ? "Background-work provider 'agent-end-drain-test' listActiveWork failed: synthetic drain failure" : null);
				assert.equal(payload.preservedCause, scenario.failedDrain);
				assert.deepEqual(payload.errors, []);
				assert.deepEqual(payload.sent, []);
			} finally {
				fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
			}
		});
	}
});
