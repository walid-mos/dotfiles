import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildControlEvent,
	claimControlNotification,
	controlNotificationKey,
	deriveActivityState,
	formatControlNoticeMessage,
	resolveControlConfig,
	shouldEmitOpenToolAttention,
	shouldNotifyControlEvent,
} from "../../src/runs/shared/subagent-control.ts";
import { nextLongRunningTrigger } from "../../src/runs/shared/long-running-guard.ts";

const config = resolveControlConfig(undefined, {
	needsAttentionAfterMs: 300,
});

describe("subagent control attention state", () => {
	it("notifies once for each distinct long-open tool call even when notice text matches", () => {
		const seen = new Set<string>();
		const event = buildControlEvent({ to: "needs_attention", runId: "run", agent: "worker", reason: "tool_open_threshold", currentTool: "bash", toolCallId: "first" });
		assert.equal(claimControlNotification(resolveControlConfig(), event, seen), true);
		assert.equal(claimControlNotification(resolveControlConfig(), { ...event, ts: event.ts + 1000 }, seen), false);
		assert.equal(claimControlNotification(resolveControlConfig(), { ...event, toolCallId: "second" }, seen), true);
	});

	it("marks a run as needing attention only after the idle threshold", () => {
		assert.equal(deriveActivityState({ config, startedAt: 0, lastActivityAt: 0, now: 50 }), undefined);
		assert.equal(deriveActivityState({ config, startedAt: 0, lastActivityAt: 0, turnCount: 1, now: 400 }), "needs_attention");
		assert.equal(deriveActivityState({ config, startedAt: 0, lastActivityAt: 0, currentTool: "bash", now: 400 }), undefined);
		assert.equal(deriveActivityState({ config, startedAt: 0, turnCount: 1, now: 400 }), "needs_attention");
	});

	it("marks a zero-turn run as needing attention once idle", () => {
		assert.equal(deriveActivityState({ config, startedAt: 0, lastActivityAt: 0, turnCount: 0, now: 400 }), "needs_attention");
		assert.equal(deriveActivityState({ config, startedAt: 0, lastActivityAt: 0, now: 400 }), "needs_attention");
	});

	it("builds compact needs-attention control events", () => {
		const event = buildControlEvent({
			to: "needs_attention",
			runId: "run-1",
			agent: "worker",
			index: 2,
			ts: 1_000,
			lastActivityAt: 100,
		});
		assert.deepEqual(event, {
			type: "needs_attention",
			to: "needs_attention",
			ts: 1_000,
			runId: "run-1",
			agent: "worker",
			index: 2,
			message: "worker needs attention (no observed activity for 0s)",
			reason: "idle",
			elapsedMs: 900,
		});
	});

	it("supports a specific attention message", () => {
		const event = buildControlEvent({
			to: "needs_attention",
			runId: "run-1",
			agent: "worker",
			message: "worker needs attention",
		});

		assert.equal(event.message, "worker needs attention");
	});

	it("defaults notifications to active-long-running, needs attention, and stale", () => {
		const event = buildControlEvent({ to: "needs_attention", runId: "run-1", agent: "worker" });
		const activeEvent = buildControlEvent({ type: "active_long_running", to: "active_long_running", runId: "run-1", agent: "worker" });
		assert.equal(shouldNotifyControlEvent(config, event), true);
		assert.equal(shouldNotifyControlEvent(config, activeEvent), true);
		assert.deepEqual(config.notifyOn, ["active_long_running", "needs_attention", "stale"]);
		assert.deepEqual(config.notifyChannels, ["event", "async"]);
	});

	it("defaults active-long-running notices to elapsed time only", () => {
		const defaults = resolveControlConfig();

		assert.equal(defaults.activeNoticeAfterMs, 120_000);
		assert.equal(defaults.activeNoticeAfterTurns, undefined);
		assert.equal(defaults.activeNoticeAfterTokens, undefined);
		assert.equal(nextLongRunningTrigger(defaults, {
			startedAt: 0,
			now: 77_000,
			turns: 50,
			tokens: 800_000,
		}), undefined);
		assert.equal(nextLongRunningTrigger(defaults, {
			startedAt: 0,
			now: 120_000,
			turns: 1,
			tokens: 1,
		}), "time_threshold");
	});

	it("marks non-exempt open tools for attention at the active threshold", () => {
		const defaults = resolveControlConfig();

		assert.equal(shouldEmitOpenToolAttention({ config: defaults, currentTool: "bash", currentToolStartedAt: 0, now: 119_999 }), false);
		assert.equal(shouldEmitOpenToolAttention({ config: defaults, currentTool: "bash", currentToolStartedAt: 0, now: 120_000 }), true);
		assert.equal(shouldEmitOpenToolAttention({ config: defaults, currentTool: "contact_supervisor", currentToolStartedAt: 0, now: 999_999 }), false);
		assert.equal(shouldEmitOpenToolAttention({ config: { ...defaults, enabled: false }, currentTool: "bash", currentToolStartedAt: 0, now: 999_999 }), false);
	});

	it("supports opt-in turn and token long-running thresholds", () => {
		const tokenBudget = resolveControlConfig(undefined, { activeNoticeAfterMs: 999_999, activeNoticeAfterTokens: 500_000 });
		const turnBudget = resolveControlConfig(undefined, { activeNoticeAfterMs: 999_999, activeNoticeAfterTurns: 5 });

		assert.equal(nextLongRunningTrigger(tokenBudget, {
			startedAt: 0,
			now: 77_000,
			turns: 1,
			tokens: 500_000,
		}), "token_threshold");
		assert.equal(nextLongRunningTrigger(turnBudget, {
			startedAt: 0,
			now: 77_000,
			turns: 5,
			tokens: 1,
		}), "turn_threshold");
	});

	it("resolves custom notification config", () => {
		const custom = resolveControlConfig(undefined, {
			needsAttentionAfterMs: 1234,
			activeNoticeAfterMs: 2345,
			activeNoticeAfterTurns: 7,
			activeNoticeAfterTokens: 8000,
			failedToolAttemptsBeforeAttention: 4,
			notifyOn: ["active_long_running", "needs_attention", "nope" as never],
			notifyChannels: ["event", "intercom" as never, "bad" as never],
		});
		assert.equal(custom.needsAttentionAfterMs, 1234);
		assert.equal(custom.activeNoticeAfterMs, 2345);
		assert.equal(custom.activeNoticeAfterTurns, 7);
		assert.equal(custom.activeNoticeAfterTokens, 8000);
		assert.equal(custom.failedToolAttemptsBeforeAttention, 4);
		assert.deepEqual(custom.notifyOn, ["active_long_running", "needs_attention"]);
		assert.deepEqual(custom.notifyChannels, ["event"]);
	});

	it("falls back to defaults for invalid non-empty notification arrays", () => {
		const custom = resolveControlConfig(undefined, {
			notifyOn: ["bogus" as never],
			notifyChannels: ["bogus" as never],
		});
		assert.deepEqual(custom.notifyOn, ["active_long_running", "needs_attention", "stale"]);
		assert.deepEqual(custom.notifyChannels, ["event", "async"]);
	});

	it("allows empty notification arrays to disable notifications", () => {
		const custom = resolveControlConfig(undefined, {
			notifyOn: [],
			notifyChannels: [],
		});
		const event = buildControlEvent({ to: "needs_attention", runId: "run-1", agent: "worker" });
		assert.deepEqual(custom.notifyOn, []);
		assert.deepEqual(custom.notifyChannels, []);
		assert.equal(shouldNotifyControlEvent(custom, event), false);
	});

	it("formats control notices with a proactive hint and concrete commands", () => {
		const event = buildControlEvent({ to: "needs_attention", runId: "78f659a3", agent: "worker" });

		const message = formatControlNoticeMessage(event, "subagent-worker-78f659a3");

		assert.match(message, /Subagent needs attention: worker/);
		assert.match(message, /Hint: Inspect status first unless the run is clearly blocked/);
		assert.match(message, /steer for a top-level live async child, routed resume for a live nested child/);
		assert.match(message, /Top-level live async nudge: subagent\(\{ action: "steer", id: "78f659a3", message: "What are you blocked on\?/);
		assert.match(message, /Routed live nested nudge: subagent\(\{ action: "resume", id: "78f659a3", message: "What are you blocked on\?/);
		assert.match(message, /Direct intercom target: subagent-worker-78f659a3/);
		assert.match(message, /Status: subagent\(\{ action: "status", id: "78f659a3" \}\)/);
		assert.match(message, /Interrupt: subagent\(\{ action: "interrupt", id: "78f659a3" \}\)/);
		assert.doesNotMatch(message, /Wait:/);
	});

	it("formats open-tool attention notices with tool facts", () => {
		const event = buildControlEvent({
			to: "needs_attention",
			runId: "78f659a3",
			agent: "worker",
			reason: "tool_open_threshold",
			message: "worker has had tool 'bash' open for 240s",
			currentTool: "bash",
			currentToolDurationMs: 240_000,
			currentPath: "scripts/run-tests.sh",
		});

		const message = formatControlNoticeMessage(event, "subagent-worker-78f659a3");

		assert.match(message, /worker has had tool 'bash' open for 240s/);
		assert.match(message, /Facts: tool bash 240s \| path scripts\/run-tests\.sh/);
		assert.match(message, /Inspect the running command and recent output/);
		assert.match(message, /A queued steer does not cancel an in-flight bash call/);
		assert.match(message, /dev server or watch command/);
		assert.match(message, /Elapsed time alone does not prove/);
		assert.match(message, /Transcript: subagent\(\{ action: "status", id: "78f659a3", view: "transcript" \}\)/);
		assert.doesNotMatch(message, /live async nudge|live nested nudge|Interrupt:|Direct intercom target:/);
	});

	it("scopes open-bash transcript inspection to the selected child without suggesting a run-wide interrupt", () => {
		const event = buildControlEvent({
			to: "needs_attention", runId: "parallel-run", agent: "worker", index: 2,
			reason: "tool_open_threshold", currentTool: "bash",
		});
		const message = formatControlNoticeMessage(event);
		assert.match(message, /Transcript: subagent\(\{ action: "status", id: "parallel-run", view: "transcript", index: 2 \}\)/);
		assert.match(message, /interrupt is run-scoped and may affect siblings/);
		assert.doesNotMatch(message, /subagent\(\{ action: "interrupt"/);
	});

	it("preserves nudge guidance for other tools and bash notices unrelated to an open call", () => {
		for (const input of [
			{ reason: "tool_open_threshold" as const, currentTool: "read" },
			{ reason: "tool_failures" as const, currentTool: "bash" },
		]) {
			const event = buildControlEvent({ to: "needs_attention", runId: "run-1", agent: "worker", ...input });
			const message = formatControlNoticeMessage(event);
			assert.match(message, /Top-level live async nudge:/);
			assert.doesNotMatch(message, /A queued steer does not cancel/);
		}
	});

	it("uses bounded task context in nudges and de-duplicates distinct contexts", () => {
		const first = buildControlEvent({ to: "needs_attention", runId: "run-1", agent: "reviewer", label: `release gate ${"x".repeat(200)}` });
		const second = buildControlEvent({ to: "needs_attention", runId: "run-1", agent: "reviewer", label: "security gate" });
		const firstMessage = formatControlNoticeMessage(first);
		const nudge = firstMessage.match(/message: ("(?:[^"\\]|\\.)*")/)?.[1];
		assert.ok(nudge);
		assert.ok((JSON.parse(nudge) as string).length <= 160);
		assert.notEqual(controlNotificationKey(first), controlNotificationKey(second));
	});

	it("formats supervisor-request notices with pending-channel guidance", () => {
		const event = buildControlEvent({
			to: "needs_attention",
			runId: "78f659a3",
			agent: "worker",
			reason: "supervisor_request",
			currentTool: "contact_supervisor",
		});

		const message = formatControlNoticeMessage(event, "subagent-worker-78f659a3");

		assert.match(message, /waiting for a supervisor reply/);
		assert.match(message, /subagent_supervisor\(\{ action: "pending" \}\)/);
		assert.doesNotMatch(message, /action: "(?:steer|resume)"/);

		const external = formatControlNoticeMessage(buildControlEvent({
			to: "needs_attention",
			runId: "78f659a3",
			agent: "worker",
			reason: "supervisor_request",
		}));
		assert.match(external, /intercom pending/);
	});

	it("formats active-long-running notices as informational", () => {
		const event = buildControlEvent({
			type: "active_long_running",
			to: "active_long_running",
			runId: "78f659a3",
			agent: "worker",
			turns: 15,
			tokens: 160000,
			toolCount: 42,
			currentTool: "edit",
			currentPath: "src/runs/background/async-status.ts",
			reason: "turn_threshold",
		});

		const message = formatControlNoticeMessage(event, "subagent-worker-78f659a3-1");

		assert.match(message, /Subagent active but long-running: worker/);
		assert.match(message, /Inspect status/);
		assert.match(message, /steer for a top-level live async child, routed resume for a live nested child/);
		assert.match(message, /Top-level live async nudge: subagent\(\{ action: "steer", id: "78f659a3", message: "Check tool edit at path src\/runs\/background\/async-status\.ts/);
		assert.match(message, /Routed live nested nudge: subagent\(\{ action: "resume", id: "78f659a3", message: "Check tool edit at path src\/runs\/background\/async-status\.ts/);
		assert.match(message, /15 turns/);
		assert.match(message, /160000 tokens/);
		assert.match(message, /path src\/runs\/background\/async-status\.ts/);
		assert.doesNotMatch(message, /Subagent needs attention/);
	});

	it("dedupes notifications once per child target and attention state", () => {
		const event = buildControlEvent({ to: "needs_attention", runId: "run-1", agent: "worker", index: 0 });
		const seen = new Set<string>();

		assert.match(controlNotificationKey(event, "subagent-worker-run-1-1"), /^subagent-worker-run-1-1:needs_attention:idle:[a-f0-9]{8}$/);
		assert.equal(claimControlNotification(resolveControlConfig(), event, seen, "subagent-worker-run-1-1"), true);
		assert.equal(claimControlNotification(resolveControlConfig(), event, seen, "subagent-worker-run-1-1"), false);

		const terminalEvent = buildControlEvent({
			to: "needs_attention",
			runId: "run-1",
			agent: "worker",
			index: 0,
			message: "worker needs attention",
			reason: "tool_failures",
		});
		assert.equal(claimControlNotification(resolveControlConfig(), terminalEvent, seen, "subagent-worker-run-1-1"), true);
	});
});
