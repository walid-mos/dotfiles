import { USER_DECISION_GUIDANCE } from "./native-supervisor-channel.ts";
import { supervisorReplyHint } from "./supervisor-ui.ts";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { createNativeSupervisorChannel } from "./native-supervisor-channel.ts";

type SupervisorChannel = Pick<ReturnType<typeof createNativeSupervisorChannel>, "pending">;
const PENDING_CONTEXT_TYPE = "subagent_supervisor_pending";
const MAX_CONTEXT_REQUESTS = 5;
const MAX_REQUEST_BODY_CHARS = 1_000;

function pendingContext(channel: SupervisorChannel): string | undefined {
	const requests = [...channel.pending.values()].filter((request) => request.expectsReply);
	if (!requests.length) return undefined;
	const lines = [`${requests.length} pending supervisor decision(s). The children are waiting for replies, not doing active work.`];
	for (const request of requests.slice(0, MAX_CONTEXT_REQUESTS)) {
		const body = request.message || JSON.stringify(request.interview) || "(no request body)";
		const excerpt = body.length > MAX_REQUEST_BODY_CHARS ? `${body.slice(0, MAX_REQUEST_BODY_CHARS)} [truncated]` : body;
		lines.push(`Request ${request.id}: ${request.agent} [${request.runId}#${request.childIndex}]`, excerpt, supervisorReplyHint(request.id));
	}
	lines.push('Full queue: subagent_supervisor({ action: "pending" })', USER_DECISION_GUIDANCE);
	return lines.join("\n\n");
}

/** Keep live decisions available after discussion or compaction without persisting reminders or starting turn loops. */
export function registerSupervisorContext(pi: ExtensionAPI, channel: SupervisorChannel): void {
	pi.on("context", (event) => {
		const messages = event.messages.filter((message) => message.role !== "custom" || message.customType !== PENDING_CONTEXT_TYPE);
		const content = pendingContext(channel);
		if (!content) return messages.length === event.messages.length ? undefined : { messages };
		return {
			messages: [
				...messages,
				{
					role: "custom" as const,
					customType: PENDING_CONTEXT_TYPE,
					content,
					display: false,
					timestamp: Date.now(),
				},
			],
		};
	});
}
