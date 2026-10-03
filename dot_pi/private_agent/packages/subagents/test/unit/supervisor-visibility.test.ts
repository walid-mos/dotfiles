import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { it } from "node:test";
import { createNativeSupervisorChannel, ensureSupervisorChannelDir, resolveSupervisorChannelDir } from "../../src/intercom/native-supervisor-channel.ts";
import type { SubagentState } from "../../src/shared/types.ts";

type Notice = { content: string; details: { requestId: string } };
type Tool = { name: string; execute(id: string, params: { action: "pending" }): Promise<{ content: Array<{ text?: string }> }> };
type DetachRequest = { requestId: string; runId: string; agent: string; childIndex: number };

function mailbox() {
	const owner = randomUUID();
	const runId = randomUUID();
	const id = randomUUID();
	const channelDir = resolveSupervisorChannelDir(runId, "oracle", 0);
	ensureSupervisorChannelDir(channelDir);
	fs.writeFileSync(
		path.join(channelDir, "requests", `${id}.json`),
		JSON.stringify({
			type: "subagent.supervisor.request",
			id,
			createdAt: Date.now(),
			reason: "need_decision",
			message: "May I narrow the screenshot fix to clicks only?",
			expectsReply: true,
			orchestratorSessionId: owner,
			runId,
			agent: "oracle",
			childIndex: 0,
		}),
	);
	return { owner, runId, id, channelDir };
}

it("retries an unaccepted blocking notification without duplicating the ask or detach", async () => {
	const box = mailbox();
	const tools = new Map<string, Tool>();
	const notices: Notice[] = [];
	const detaches: DetachRequest[] = [];
	let attempts = 0;
	// SAFETY: the fake supplies every Pi API and state member exercised by native mailbox discovery.
	const channel = createNativeSupervisorChannel(
		{
			getAllTools: () => [],
			registerTool: (tool: Tool) => tools.set(tool.name, tool),
			sendMessage: (notice: Notice) => {
				attempts++;
				if (attempts === 1) throw new Error("Stale extension context");
				notices.push(notice);
			},
			events: { emit: (_name: string, payload: DetachRequest) => detaches.push(payload) },
		} as never,
		{
			supervisorOwnerSessionId: box.owner,
			asyncJobs: new Map(),
			foregroundControls: new Map(),
		} as SubagentState,
		{ getChannelDirs: () => ({ dirs: [box.channelDir] }) },
	);
	channel.registerTools();
	try {
		const tool = tools.get("subagent_supervisor")!;
		await tool.execute("first", { action: "pending" });
		assert.equal(channel.pending.size, 1);
		await tool.execute("retry", { action: "pending" });
		assert.equal(notices.length, 1, "a failed announcement must be retried, not permanently marked seen");
		assert.equal(notices[0]?.details.requestId, box.id);
		await tool.execute("again", { action: "pending" });
		assert.equal(attempts, 2, "an accepted announcement must not be sent twice");
		assert.equal(detaches.length, 1, "delivery retries must not detach the child again");
	} finally {
		channel.dispose();
		fs.rmSync(box.channelDir, { recursive: true, force: true });
	}
});
