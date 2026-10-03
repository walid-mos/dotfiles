import assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import {
	attachNestedChildrenToResultChildren,
	resolveSubagentResultStatus,
} from "../../src/runs/shared/result-summary.ts";

describe("result summary helpers", () => {
	it("does not promote running children to grouped completion", () => {
		assert.equal(resolveSubagentResultStatus({ state: "running" }), "running");
		assert.equal(resolveSubagentResultStatus({ state: "running", success: true }), "running");
	});

	it("attaches compact nested children under their parent result child without route secrets", () => {
		const children = attachNestedChildrenToResultChildren("root-run", [
			{ agent: "owner-a", status: "completed", summary: "done", index: 0 },
			{ agent: "owner-b", status: "completed", summary: "done", index: 1 },
		], [{
			id: "nested-a",
			parentRunId: "root-run",
			parentStepIndex: 1,
			depth: 1,
			path: [{ runId: "root-run", stepIndex: 1 }],
			state: "complete",
			agent: "reviewer",
			model: "provider/gpt-5.6-luna:medium",
			thinking: "medium",
			sessionFile: path.join(os.tmpdir(), "nested-a.jsonl"),
			steps: [{ agent: "leaf", status: "complete", model: "provider/leaf", thinking: "low" }],
			controlInbox: "/tmp/should-not-leak",
			capabilityToken: "secret-token",
			children: [{
				id: "nested-grandchild",
				parentRunId: "nested-a",
				depth: 2,
				path: [{ runId: "root-run", stepIndex: 1 }, { runId: "nested-a" }],
				state: "complete",
				agent: "auditor",
				controlInbox: "/tmp/grandchild-should-not-leak",
				capabilityToken: "grandchild-secret",
			}],
		}]);

		const nested = children[1]?.children?.[0];
		const grandchild = nested?.children?.[0];
		assert.equal(children[0]?.children, undefined);
		assert.equal(nested?.id, "nested-a");
		assert.equal(nested?.model, "provider/gpt-5.6-luna:medium");
		assert.equal(nested?.thinking, "medium");
		assert.equal(nested?.steps?.[0]?.model, "provider/leaf");
		assert.equal(nested?.steps?.[0]?.thinking, "low");
		assert.equal(Object.hasOwn(nested ?? {}, "controlInbox"), false);
		assert.equal(Object.hasOwn(nested ?? {}, "capabilityToken"), false);
		assert.equal(grandchild?.id, "nested-grandchild");
		assert.equal(Object.hasOwn(grandchild ?? {}, "controlInbox"), false);
		assert.equal(Object.hasOwn(grandchild ?? {}, "capabilityToken"), false);
	});

	it("resolves paused, detached, and signal-terminated statuses", () => {
		assert.equal(resolveSubagentResultStatus({ interrupted: true }), "paused");
		assert.equal(resolveSubagentResultStatus({ detached: true }), "detached");
		assert.equal(resolveSubagentResultStatus({ processSignal: "SIGTERM", exitCode: 1 }), "stopped");
		assert.equal(resolveSubagentResultStatus({ processSignal: "SIGTERM", exitCode: 1, timedOut: true }), "failed");
		assert.equal(resolveSubagentResultStatus({ processSignal: "SIGTERM", exitCode: 0, success: true }), "completed");
		assert.equal(resolveSubagentResultStatus({ success: true }), "completed");
		assert.equal(resolveSubagentResultStatus({ exitCode: 1 }), "failed");
	});
});
