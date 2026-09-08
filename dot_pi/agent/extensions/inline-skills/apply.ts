/**
 * Insert a confirmed skill completion in place of the `/skill:` token.
 *
 * When the cursor is inside a `/skill:` token, the confirmed item (e.g.
 * "skill:swarm") is inserted with a leading slash and a trailing space so the
 * user can keep typing. Outside a `/skill:` context, we delegate to the
 * built-in completion behavior (covers `!shell` completions, etc.).
 */
import { isSkillTokenContext } from "./token.ts";

export type AppliedCompletion = {
	lines: string[];
	cursorLine: number;
	cursorCol: number;
};

export type CompletionItem = {
	value: string;
};

export function applyInlineSkillCompletion(
	delegate: (
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		item: CompletionItem,
		prefix: string,
	) => AppliedCompletion,
	lines: string[],
	cursorLine: number,
	cursorCol: number,
	item: CompletionItem,
	prefix: string,
): AppliedCompletion {
	const currentLine = lines[cursorLine] ?? "";
	const textBefore = currentLine.slice(0, cursorCol);
	if (!isSkillTokenContext(textBefore)) {
		return delegate(lines, cursorLine, cursorCol, item, prefix);
	}

	const before = currentLine.slice(0, cursorCol - prefix.length);
	const after = currentLine.slice(cursorCol);
	const newLine = `${before}/${item.value} ${after}`;
	const newLines = [...lines];
	newLines[cursorLine] = newLine;

	return {
		lines: newLines,
		cursorLine,
		cursorCol: before.length + item.value.length + 2,
	};
}
