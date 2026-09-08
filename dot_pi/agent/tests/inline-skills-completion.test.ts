import assert from 'node:assert/strict'
import { test } from 'node:test'

import { applyInlineSkillCompletion } from '../extensions/inline-skills/apply.ts'

import type {
	AppliedCompletion,
	CompletionContext,
} from '../extensions/inline-skills/apply.ts'

type CompletionSource = CompletionContext

function replacePrefix(source: CompletionSource): AppliedCompletion {
	const currentLine = source.lines[source.cursorLine] ?? ''
	const before = currentLine.slice(0, source.cursorCol - source.prefix.length)
	const after = currentLine.slice(source.cursorCol)
	const nextLines = [...source.lines]
	nextLines[source.cursorLine] = `${before}${source.completion.value}${after}`
	return {
		lines: nextLines,
		cursorLine: source.cursorLine,
		cursorCol: before.length + source.completion.value.length,
	}
}

void test('shell bang completion delegates without inheriting skill slash prefix', () => {
	let isDelegated = false
	const applied = applyInlineSkillCompletion(
		context => {
			isDelegated = true
			return replacePrefix(context)
		},
		{
			lines: ['!pwd'],
			cursorLine: 0,
			cursorCol: 4,
			completion: { value: 'pwd', label: 'pwd' },
			prefix: 'pwd',
		},
	)
	assert.equal(isDelegated, true)
	// actual side is spread into a fresh literal so tsgolint's
	// no-unnecessary-condition sees no static predicate worth dropping
	assert.deepEqual(
		{ ...applied },
		{
			lines: ['!pwd'],
			cursorLine: 0,
			cursorCol: 4,
		},
	)
})

void test('skill token still inserts leading slash', () => {
	const applied = applyInlineSkillCompletion(replacePrefix, {
		lines: ['audit /skill:sw'],
		cursorLine: 0,
		cursorCol: 15,
		completion: { value: 'skill:swarm', label: 'swarm' },
		prefix: '/skill:sw',
	})
	assert.equal(applied.lines[0], 'audit /skill:swarm ')
})

void test('skill token mid-line keeps surrounding text intact', () => {
	const applied = applyInlineSkillCompletion(replacePrefix, {
		lines: ['fix the bug /skill:re'],
		cursorLine: 0,
		cursorCol: 21,
		completion: { value: 'skill:review', label: 'review' },
		prefix: '/skill:re',
	})
	assert.equal(applied.lines[0], 'fix the bug /skill:review ')
})
