import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const FENCE_LINE = /^( {0,3})(`{3,}|~{3,})[ \t]*(.*)$/;
const WORKFLOW_INFO = /^(?:js|javascript)[ \t]+workflow(?:[ \t]+\S.*)?[ \t]*$/;
const BARE_WORKFLOW_TAG = /^\s{0,3}(?:js|javascript)[ \t]+workflow/;
const MAX_DIAGNOSTIC_LINES = 3;
const MAX_DIAGNOSTIC_LINE_LENGTH = 80;

export type ReplyWorkflowScript = { script: string } | { error: string };

/**
 * Pi persists the whole assistant message before running its tool calls, so the
 * message that issued this subagent call is on the branch and carries the script.
 */
export function readReplyWorkflowScript(sessionManager: Pick<ExtensionContext["sessionManager"], "getBranch">, toolCallId: string): ReplyWorkflowScript {
	const branch = sessionManager.getBranch();
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index]!;
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
		if (!message.content.some((block) => block.type === "toolCall" && block.id === toolCallId)) continue;
		return scriptFromReply(message.content);
	}
	return { error: "workflow: true only works from a model subagent tool call whose assistant message contains the ```js workflow block; other callers must pass a script path such as workflow: \"./script.js\"." };
}

function scriptFromReply(content: AssistantMessage["content"]): ReplyWorkflowScript {
	const replyCalls = content.filter((block) => block.type === "toolCall" && block.name === "subagent"
		&& (block.arguments?.workflow === true || block.arguments?.workflow === "true")).length;
	if (replyCalls > 1) return { error: `This reply has ${replyCalls} subagent calls with workflow: true; a reply can carry only one. Pass other scripts as workflow file paths.` };
	const text = content.flatMap((block) => block.type === "text" && typeof block.text === "string" ? [block.text] : []).join("\n");
	const { blocks } = workflowBlocks(text);
	if (blocks.length === 1) {
		const script = blocks[0]!;
		if (!script.trim()) return { error: "The ```js workflow block in this reply is empty." };
		return { script };
	}
	if (blocks.length === 0) {
		return { error: "workflow: true requires exactly one ```js workflow fenced block in the same reply as the tool call; found 0."
			+ describeNearMissFences(content)
			+ " To launch: put the script in the reply text as a fenced code block — an opening line of exactly ```js workflow (a short label after `workflow` is allowed), the JavaScript as the body, and a closing line containing only ```." };
	}
	return { error: `workflow: true requires exactly one \`\`\`js workflow fenced block in the same reply as the tool call; found ${blocks.length}.`
		+ " Keep only the one block this reply should run; hand other scripts to the call as workflow file paths." };
}

function quoteNearMissLine(line: string): string {
	const flat = line.replace(/\r$/, "");
	if (flat.length <= MAX_DIAGNOSTIC_LINE_LENGTH) return flat;
	const anchor = flat.indexOf("```");
	const start = anchor > 40 ? anchor - 40 : 0;
	const end = Math.min(flat.length, start + MAX_DIAGNOSTIC_LINE_LENGTH);
	return (start > 0 ? "..." : "") + flat.slice(start, end) + (end < flat.length ? "..." : "");
}

function describeNearMissFences(content: AssistantMessage["content"]): string {
	const quoted: string[] = [];
	for (const [blockIndex, block] of content.entries()) {
		if (block.type !== "text" || typeof block.text !== "string" || quoted.length >= MAX_DIAGNOSTIC_LINES) continue;
		block.text.split("\n").forEach((line, lineIndex) => {
			const bare = line.replace(/\r$/, "");
			if (quoted.length >= MAX_DIAGNOSTIC_LINES) return;
			if (!bare.includes("```") && !BARE_WORKFLOW_TAG.test(bare)) return;
			quoted.push(`reply text ${blockIndex + 1}, line ${lineIndex + 1}: ${JSON.stringify(quoteNearMissLine(bare))}`);
		});
	}
	if (quoted.length === 0) return "";
	return ` Fence lines this reply contained, none of which opened a valid workflow block: ${quoted.join("; ")}.`;
}

/**
 * Collects ```js workflow / ```javascript workflow fenced blocks, skipping the
 * bodies of other fences. Info strings after `workflow` (a short label) and up
 * to three leading spaces are accepted. An unterminated tagged fence captures
 * to the end of the reply — the interpretation a renderer gives an unclosed
 * fence; a malformed capture surfaces later as a script syntax error.
 */
function workflowBlocks(text: string) {
	const lines = text.split("\n");
	const blocks: string[] = [];
	let fence: { marker: string; tagged: boolean; start: number } | undefined;
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index]!.replace(/\r$/, "");
		const match = FENCE_LINE.exec(line);
		if (!fence) {
			if (match) fence = { marker: match[2]!, tagged: WORKFLOW_INFO.test(match[3]!), start: index + 1 };
			continue;
		}
		const closeMarker = match?.[2];
		const closesFence = Boolean(match) && closeMarker![0] === fence.marker[0] && closeMarker!.length >= fence.marker.length
			&& match![3]!.trim() === "";
		if (!closesFence) continue;
		if (fence.tagged) blocks.push(lines.slice(fence.start, index).join("\n"));
		fence = undefined;
	}
	if (fence?.tagged) blocks.push(lines.slice(fence.start).join("\n"));
	return { blocks };
}
