import assert from "node:assert/strict";
import { test } from "node:test";
import {
	applyInlineSkillCompletion,
	type AppliedCompletion,
	type CompletionItem,
} from "../extensions/inline-skills/apply.ts";

function replacePrefix(
	lines: string[],
	cursorLine: number,
	cursorCol: number,
	item: CompletionItem,
	prefix: string,
): AppliedCompletion {
	const currentLine = lines[cursorLine] ?? "";
	const before = currentLine.slice(0, cursorCol - prefix.length);
	const after = currentLine.slice(cursorCol);
	const newLine = before + item.value + after;
	const nextLines = [...lines];
	nextLines[cursorLine] = newLine;
	return {
		lines: nextLines,
		cursorLine,
		cursorCol: before.length + item.value.length,
	};
}

test("shell bang completion delegates without inheriting skill slash prefix", () => {
	let delegated = false;
	const applied = applyInlineSkillCompletion(
		(...args) => {
			delegated = true;
			return replacePrefix(...args);
		},
		["!pwd"],
		0,
		4,
		{ value: "pwd" },
		"pwd",
	);
	assert.equal(delegated, true);
	assert.deepEqual(applied.lines, ["!pwd"]);
	assert.equal(applied.cursorCol, 4);
});

test("skill token still inserts leading slash", () => {
	const applied = applyInlineSkillCompletion(
		replacePrefix,
		["audit /skill:sw"],
		0,
		15,
		{ value: "skill:swarm" },
		"/skill:sw",
	);
	assert.equal(applied.lines[0], "audit /skill:swarm ");
});

test("skill token mid-line keeps surrounding text intact", () => {
	const applied = applyInlineSkillCompletion(
		replacePrefix,
		["fix the bug /skill:re"],
		0,
		21,
		{ value: "skill:review" },
		"/skill:re",
	);
	assert.equal(applied.lines[0], "fix the bug /skill:review ");
});
