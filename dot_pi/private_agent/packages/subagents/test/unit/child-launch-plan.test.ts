import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentConfig } from "../../src/agents/agents.ts";
import { resolveStepBehavior } from "../../src/runs/shared/child-launch-plan.ts";

const agent = {
	name: "worker",
	output: "report.md",
	outputMode: "file-only",
	defaultReads: ["brief.md"],
	defaultProgress: true,
	skills: ["typescript"],
	model: "openai-codex/gpt-5.6-luna",
	fast: true,
} as AgentConfig;

describe("child launch planning", () => {
	it("inherits, overrides, and explicitly disables an agent output schema", () => {
		const inherited = { type: "object", required: ["ok"] };
		const override = { type: "object", required: ["value"] };
		const schemaAgent = { ...agent, outputSchema: inherited };

		assert.equal(resolveStepBehavior(schemaAgent, {}).outputSchema, inherited);
		assert.equal(resolveStepBehavior(schemaAgent, { outputSchema: override }).outputSchema, override);
		assert.equal(resolveStepBehavior(schemaAgent, { outputSchema: false }).outputSchema, undefined);
		assert.deepEqual(resolveStepBehavior({ ...agent, outputSchema: {} }, {}).outputSchema, {});
	});
});
