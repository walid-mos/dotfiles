import assert from "node:assert/strict";
import { it } from "node:test";
import { registerSupervisorContext } from "../../src/intercom/supervisor-context.ts";

type Message = { role: string; customType?: string; content: string };
type ContextHandler = (event: { messages: Message[] }) => { messages: Message[] } | undefined;

function contextFixture() {
	let handler: ContextHandler | undefined;
	const pending = new Map([
		[
			"ask-1",
			{
				id: "ask-1",
				runId: "run-1",
				agent: "oracle",
				childIndex: 0,
				expectsReply: true,
				message: "May I narrow the screenshot fix to clicks only?",
			},
		],
	]);
	// SAFETY: registration uses only on(context); the fixture supplies all pending fields read by that handler.
	registerSupervisorContext(
		{
			on: (name: string, callback: ContextHandler) => {
				assert.equal(name, "context");
				handler = callback;
			},
		} as never,
		{ pending } as never,
	);
	return { pending, context: (messages: Message[]) => handler!({ messages })?.messages ?? messages };
}

it("keeps unanswered decisions in later parent requests without queuing more turns", () => {
	const fixture = contextFixture();
	const conversation = [{ role: "user", content: "Explain why a patch is needed." }];
	const messages = fixture.context(conversation);
	assert.equal(conversation.length, 1, "do not persist or mutate the conversation");
	assert.equal(messages.length, 2);
	assert.match(messages[1]!.content, /May I narrow the screenshot fix to clicks only\?/);
	assert.match(messages[1]!.content, /ask_user_question/);
	assert.match(messages[1]!.content, /replyTo: "ask-1"/);
	assert.match(messages[1]!.content, /Keep the request pending/);
	assert.equal(fixture.pending.size, 1, "context injection must not answer the request");
	assert.equal(fixture.context(messages).length, 2, "replace the live reminder, never accumulate copies");
});

it("removes the live reminder once the exact pending request is resolved", () => {
	const fixture = contextFixture();
	const conversation = [{ role: "user", content: "Continue investigating without a patch." }];
	const waiting = fixture.context(conversation);
	fixture.pending.delete("ask-1");
	assert.deepEqual(fixture.context(waiting), conversation);
});

it("bounds pending context and directs the parent to the complete queue", () => {
	const fixture = contextFixture();
	for (let index = 0; index < 20; index++) {
		fixture.pending.set(`ask-${index}`, {
			id: `ask-${index}`,
			runId: "run-1",
			agent: "oracle",
			childIndex: 0,
			expectsReply: true,
			message: "x".repeat(64 * 1024),
		});
	}
	const reminder = fixture.context([])[0]!.content;
	assert.ok(reminder.length < 8_000);
	assert.match(reminder, /20 pending/);
	assert.match(reminder, /subagent_supervisor\(\{ action: "pending" \}\)/);
	assert.match(reminder, /truncated/);
});

it("does not present a progress update as a blocking decision", () => {
	const fixture = contextFixture();
	fixture.pending.get("ask-1")!.expectsReply = false;
	assert.deepEqual(fixture.context([]), []);
});
