import assert from "node:assert/strict";
import { it } from "node:test";
import { buildWidgetLines } from "../../src/tui/render.ts";
import type { AsyncJobState } from "../../src/shared/types.ts";

const theme = {
	fg(_name: string, text: string): string {
		return text;
	},
	bold(text: string): string {
		return text;
	},
};

function workflowFixture(): AsyncJobState[] {
	return [
		{
			asyncId: "workflow-parent",
			asyncDir: "/tmp/workflow-parent",
			status: "running",
			mode: "workflow",
			startedAt: 0,
			updatedAt: 1_000,
			agents: ["oracle"],
			stepsTotal: 1,
			steps: [{ runId: "waiting-oracle", workflowKey: "bridge-design", agent: "oracle", status: "running" }],
		},
		{
			asyncId: "waiting-oracle",
			asyncDir: "/tmp/waiting-oracle",
			status: "running",
			mode: "single",
			parentWorkflowRunId: "workflow-parent",
			workflowKey: "bridge-design",
			agents: ["oracle"],
			startedAt: 0,
			updatedAt: 1_000,
			activityState: "needs_attention",
			stepsTotal: 1,
			steps: [{ agent: "oracle", status: "running", activityState: "needs_attention", currentTool: "contact_supervisor" }],
		},
	];
}

it("shows a materialized child's pending decision in the parent workflow counts", () => {
	const jobs = workflowFixture();
	// SAFETY: this text-only renderer uses only the fake theme's fg and bold methods.
	const output = buildWidgetLines(jobs, theme as never, 180, false).join("\n");
	assert.match(output, /0\/1 done.*1 blocked/);
	assert.doesNotMatch(output, /1 active/);
	assert.match(output, /waiting for supervisor/);
	assert.match(output, /subagent_supervisor/);
	assert.equal(jobs[0]!.steps![0]!.activityState, undefined, "rendering must not rewrite lifecycle state");
	assert.equal(jobs[1]!.status, "running");
});

it("clears the blocked workflow projection when the child continues", () => {
	const jobs = workflowFixture();
	const child = jobs[1]!;
	child.activityState = "active_long_running";
	child.steps![0]!.activityState = "active_long_running";
	child.steps![0]!.currentTool = "read";
	// SAFETY: this text-only renderer uses only the fake theme's fg and bold methods.
	const output = buildWidgetLines(jobs, theme as never, 180, false).join("\n");
	assert.match(output, /0\/1 done.*1 active/);
	assert.doesNotMatch(output, /1 blocked|waiting for supervisor/);
});
