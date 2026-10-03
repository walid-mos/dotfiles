import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	resolveConfigDefaultTimeoutMs,
	resolveSingleAgentLaunchTimeout,
} from "../../src/runs/foreground/subagent-executor.ts";

describe("single-agent launch timeout wiring", () => {
	it("async single runs are unbounded without an explicit/agent/config timeout", () => {
		assert.deepEqual(resolveSingleAgentLaunchTimeout({}, true), {});
	});

	it("foreground runs are unbounded without an explicit/agent/config timeout", () => {
		assert.deepEqual(resolveSingleAgentLaunchTimeout({}, false), {});
	});

	it("honors an explicit timeoutMs on async runs", () => {
		assert.deepEqual(resolveSingleAgentLaunchTimeout({ timeoutMs: 5_000 }, true), {
			timeoutMs: 5_000,
		});
	});

	it("honors the maxRuntimeMs alias on async runs", () => {
		assert.deepEqual(resolveSingleAgentLaunchTimeout({ maxRuntimeMs: 7_000 }, true), {
			timeoutMs: 7_000,
		});
	});

	it("rejects non-positive timeouts", () => {
		const result = resolveSingleAgentLaunchTimeout({ timeoutMs: 0 }, true);
		assert.ok(result.error);
		assert.match(result.error!, /positive integer/);
	});

	it("rejects explicit timeouts above the maximum schedulable timer delay", () => {
		for (const key of ["timeoutMs", "maxRuntimeMs"] as const) {
			const result = resolveSingleAgentLaunchTimeout({ [key]: 2_147_483_648 }, true);
			assert.equal(result.error, `${key} must be a positive integer no larger than 2147483647.`);
		}
		assert.deepEqual(resolveSingleAgentLaunchTimeout({ timeoutMs: 2_147_483_647 }, true), {
			timeoutMs: 2_147_483_647,
		});
	});

	it("rejects mismatched alias values", () => {
		const result = resolveSingleAgentLaunchTimeout({ timeoutMs: 1_000, maxRuntimeMs: 2_000 }, true);
		assert.ok(result.error);
		assert.match(result.error!, /aliases/);
	});

	it("leaves async chains unbounded at the top level (children resolve their own deadlines)", () => {
		assert.deepEqual(
			resolveSingleAgentLaunchTimeout({ agent: "worker", task: "x", chain: [{ agent: "worker", task: "y" }] }, true),
			{},
		);
	});

	it("leaves async parallel tasks unbounded at the top level", () => {
		assert.deepEqual(
			resolveSingleAgentLaunchTimeout({ agent: "worker", task: "x", tasks: [{ agent: "worker", task: "y" }] }, true),
			{},
		);
	});

	it("leaves async workflowScript unbounded at the top level", () => {
		assert.deepEqual(
			resolveSingleAgentLaunchTimeout({ workflowScript: "return runs.run('a', { agent: 'worker', task: 'x' })" }, true),
			{},
		);
	});

	it("explicit top-level timeout still applies to async chains", () => {
		assert.deepEqual(
			resolveSingleAgentLaunchTimeout({ agent: "worker", task: "x", chain: [{ agent: "worker", task: "y" }], timeoutMs: 5_000 }, true),
			{ timeoutMs: 5_000 },
		);
	});

	const NINETY_MIN = 90 * 60 * 1000;

	it("applies the global config default to foreground single runs", () => {
		assert.deepEqual(resolveSingleAgentLaunchTimeout({}, false, NINETY_MIN), {
			timeoutMs: NINETY_MIN,
		});
	});

	it("applies the global config default to composite foreground runs (parallel/chain)", () => {
		assert.deepEqual(
			resolveSingleAgentLaunchTimeout({ agent: "worker", task: "x", tasks: [{ agent: "worker", task: "y" }] }, false, NINETY_MIN),
			{ timeoutMs: NINETY_MIN },
		);
		assert.deepEqual(
			resolveSingleAgentLaunchTimeout({ agent: "worker", task: "x", chain: [{ agent: "worker", task: "y" }] }, false, NINETY_MIN),
			{ timeoutMs: NINETY_MIN },
		);
	});

	it("applies the global config default to async single-agent runs", () => {
		assert.deepEqual(resolveSingleAgentLaunchTimeout({}, true, NINETY_MIN), {
			timeoutMs: NINETY_MIN,
		});
	});

	it("lets an explicit call timeout win over the global config default", () => {
		assert.deepEqual(resolveSingleAgentLaunchTimeout({ timeoutMs: 5_000 }, false, NINETY_MIN), {
			timeoutMs: 5_000,
		});
	});

	it("keeps composite async runs unbounded even with a global config default", () => {
		assert.deepEqual(
			resolveSingleAgentLaunchTimeout({ agent: "worker", task: "x", tasks: [{ agent: "worker", task: "y" }] }, true, NINETY_MIN),
			{},
		);
	});
});

describe("resolveConfigDefaultTimeoutMs", () => {
	it("returns a positive integer unchanged", () => {
		assert.equal(resolveConfigDefaultTimeoutMs(90 * 60 * 1000), 90 * 60 * 1000);
	});

	it("treats unset config as no default", () => {
		assert.equal(resolveConfigDefaultTimeoutMs(undefined), undefined);
	});

	it("ignores non-positive, non-integer, and non-numeric values", () => {
		assert.equal(resolveConfigDefaultTimeoutMs(0), undefined);
		assert.equal(resolveConfigDefaultTimeoutMs(-1), undefined);
		assert.equal(resolveConfigDefaultTimeoutMs(1.5), undefined);
		assert.equal(resolveConfigDefaultTimeoutMs("600000" as unknown), undefined);
		assert.equal(resolveConfigDefaultTimeoutMs(Number.NaN), undefined);
	});

	it("accepts the maximum schedulable timer delay but ignores anything larger", () => {
		// 2_147_483_647 is the largest delay a Node.js timer can honor; above it
		// setTimeout overflows to ~1ms and the run would expire almost immediately.
		assert.equal(resolveConfigDefaultTimeoutMs(2_147_483_647), 2_147_483_647);
		assert.equal(resolveConfigDefaultTimeoutMs(2_147_483_648), undefined);
		assert.equal(resolveConfigDefaultTimeoutMs(Number.MAX_SAFE_INTEGER), undefined);
	});
});
