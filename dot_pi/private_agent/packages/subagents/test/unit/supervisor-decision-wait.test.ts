import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, it } from "node:test";
import {
	createNativeSupervisorChannel,
	ensureSupervisorChannelDir,
	registerNativeSupervisorClient,
	resolveSupervisorChannelDir,
} from "../../src/intercom/native-supervisor-channel.ts";
import { buildControlEvent, formatControlNoticeMessage } from "../../src/runs/shared/subagent-control.ts";
import type { SubagentState } from "../../src/shared/types.ts";

type Reply = { content: Array<{ text?: string }>; details?: { pending?: Array<{ id: string; message?: string }> } };
type Tool = { name: string; execute(id: string, params: unknown, signal?: AbortSignal): Promise<Reply> };
const channels: string[] = [];
const originalTimeout = process.env.PI_INTERCOM_ASK_TIMEOUT_MS;

function mailbox() {
	const runId = randomUUID();
	const owner = randomUUID();
	const channelDir = resolveSupervisorChannelDir(runId, "worker", 0);
	channels.push(channelDir);
	ensureSupervisorChannelDir(channelDir);
	return { channelDir, runId, owner };
}

function parentChannel(box: ReturnType<typeof mailbox>) {
	const tools = new Map<string, Tool>();
	const notices: unknown[] = [];
	const channel = createNativeSupervisorChannel({
		getAllTools: () => [],
		registerTool: (tool: Tool) => tools.set(tool.name, tool),
		sendMessage: (message: unknown) => notices.push(message),
	} as never, {
		supervisorOwnerSessionId: box.owner,
		asyncJobs: new Map(),
		foregroundControls: new Map(),
	} as SubagentState, { getChannelDirs: () => ({ dirs: [box.channelDir] }) });
	channel.registerTools();
	return { channel, notices, tool: tools.get("subagent_supervisor")! };
}

afterEach(() => {
	if (originalTimeout === undefined) delete process.env.PI_INTERCOM_ASK_TIMEOUT_MS;
	else process.env.PI_INTERCOM_ASK_TIMEOUT_MS = originalTimeout;
	for (const channel of channels.splice(0)) fs.rmSync(channel, { recursive: true, force: true });
});

it("keeps an unanswered decision replyable after ten minutes without rediscovering its transcript", async () => {
	delete process.env.PI_INTERCOM_ASK_TIMEOUT_MS;
	const box = mailbox();
	const id = randomUUID();
	const question = "May I continue after the recovery comparison?";
	fs.writeFileSync(path.join(box.channelDir, "requests", `${id}.json`), JSON.stringify({
		type: "subagent.supervisor.request", id,
		createdAt: Date.now() - 11 * 60 * 1000,
		reason: "need_decision", message: question, expectsReply: true,
		orchestratorSessionId: box.owner, runId: box.runId, agent: "worker", childIndex: 0,
	}));
	const parent = parentChannel(box);
	try {
		const first = await parent.tool.execute("pending", { action: "pending" });
		assert.deepEqual(first.details?.pending?.map(request => request.id), [id]);
		assert.match(first.content[0]!.text!, /May I continue after the recovery comparison\?/);
		assert.equal(first.details?.pending?.[0]?.message, question);
		await parent.tool.execute("pending-again", { action: "pending" });
		assert.equal(parent.notices.length, 1, "querying the same ask must not wake the parent again");
		await parent.tool.execute("reply", { action: "reply", replyTo: id, message: "Proceed with the preserved changes." });
		const reply = JSON.parse(fs.readFileSync(path.join(box.channelDir, "replies", `${id}.json`), "utf8"));
		assert.equal(reply.message, "Proceed with the preserved changes.");
	} finally { parent.channel.dispose(); }
});

it("guides the parent through the user questionnaire and back to the exact waiting request", async () => {
	const box = mailbox();
	const id = randomUUID();
	fs.writeFileSync(path.join(box.channelDir, "requests", `${id}.json`), JSON.stringify({
		type: "subagent.supervisor.request", id, createdAt: Date.now(),
		reason: "need_decision", message: "Which behavior should the UI use?", expectsReply: true,
		orchestratorSessionId: box.owner, runId: box.runId, agent: "worker", childIndex: 0,
	}));
	const parent = parentChannel(box);
	try {
		await parent.tool.execute("pending", { action: "pending" });
		const notice = parent.notices[0] as { content: string };
		assert.match(notice.content, /ask_user_question/);
		assert.match(notice.content, /parent session/);
		assert.match(notice.content, /chat.*cancel/i);
		assert.ok(notice.content.includes(`replyTo: "${id}"`));
		assert.doesNotMatch(notice.content, /action: "(?:steer|resume)"/);
		assert.equal(parent.channel.pending.has(id), true, "surfacing the question must not unblock the child");
		assert.deepEqual(fs.readdirSync(path.join(box.channelDir, "replies")), []);
	} finally { parent.channel.dispose(); }
});

it("does not turn a default blocking decision into an implicit timed retry", async () => {
	delete process.env.PI_INTERCOM_ASK_TIMEOUT_MS;
	const box = mailbox();
	let child!: Tool;
	registerNativeSupervisorClient({ getAllTools: () => [], registerTool: (tool: Tool) => { child = tool; } } as never, {
		channelDir: box.channelDir, runId: box.runId, agent: "worker", childIndex: 0, orchestratorSessionId: box.owner,
	});
	const abort = new AbortController();
	const waiting = child.execute("ask", { reason: "need_decision", message: "Approve the recovery?" }, abort.signal);
	const cancellation = assert.rejects(waiting, /Supervisor request cancelled/);
	try {
		const files = fs.readdirSync(path.join(box.channelDir, "requests"));
		assert.equal(files.length, 1);
		const request = JSON.parse(fs.readFileSync(path.join(box.channelDir, "requests", files[0]!), "utf8"));
		assert.equal(request.expiresAt, undefined, "the owning run/cancellation, not a hidden ask timer, owns the wait");
	} finally {
		abort.abort();
		await cancellation;
	}
	assert.deepEqual(fs.readdirSync(path.join(box.channelDir, "requests")), []);
});

it("preserves an explicitly requested supervisor timeout", async () => {
	process.env.PI_INTERCOM_ASK_TIMEOUT_MS = "30000";
	const box = mailbox();
	let child!: Tool;
	registerNativeSupervisorClient({ getAllTools: () => [], registerTool: (tool: Tool) => { child = tool; } } as never, {
		channelDir: box.channelDir, runId: box.runId, agent: "worker", childIndex: 0, orchestratorSessionId: box.owner,
	});
	const abort = new AbortController();
	const waiting = child.execute("ask", { reason: "need_decision", message: "Approve?" }, abort.signal);
	const cancellation = assert.rejects(waiting, /Supervisor request cancelled/);
	try {
		const [file] = fs.readdirSync(path.join(box.channelDir, "requests"));
		const request = JSON.parse(fs.readFileSync(path.join(box.channelDir, "requests", file!), "utf8"));
		assert.equal(request.expiresAt - request.createdAt, 30000);
	} finally {
		abort.abort();
		await cancellation;
	}
});

it("routes a blocked decision to its reply channel rather than suggesting a resume or steer", () => {
	const notice = formatControlNoticeMessage(buildControlEvent({
		to: "needs_attention", runId: "waiting-worker", agent: "worker", index: 0,
		reason: "supervisor_request", currentTool: "contact_supervisor",
	}));
	assert.match(notice, /waiting for a supervisor reply/i);
	assert.match(notice, /subagent_supervisor\(\{ action: "pending" \}\)/);
	assert.doesNotMatch(notice, /action: "(?:steer|resume)"/);
});
