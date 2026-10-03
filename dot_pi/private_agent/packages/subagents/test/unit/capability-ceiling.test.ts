import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	intersectSubagentCapabilityCeilings,
	parseSubagentCapabilityCeiling,
} from "../../src/runs/shared/capability-ceiling.ts";

describe("subagent capability ceiling", () => {
	it("keeps explicit empty allowlists distinct from unrestricted state", () => {
		const ceiling = intersectSubagentCapabilityCeilings({ version: 1, allowedTools: [], denyExtensions: false, sources: ["test"] });
		assert.deepEqual(ceiling?.allowedTools, []);
		assert.equal(intersectSubagentCapabilityCeilings(), undefined);
	});

	it("rejects malformed inherited policy payloads", () => {
		assert.throws(() => parseSubagentCapabilityCeiling({ version: 1, allowedTools: ["read"], denyExtensions: true }), /sources/);
		assert.throws(() => parseSubagentCapabilityCeiling({ version: 2, allowedTools: ["read"], denyExtensions: true, sources: ["plan"] }), /version/);
	});
});
