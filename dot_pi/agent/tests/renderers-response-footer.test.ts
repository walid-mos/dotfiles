import assert from 'node:assert/strict'
import test, { after } from 'node:test'

import { AssistantMessageComponent } from '@earendil-works/pi-coding-agent'

import { installRenderers } from '../extensions/renderers/install-renderers.ts'

import { runtime, visible } from './renderers-fixture.ts'
import { assistantMessage } from './response-fixture.ts'

after(installRenderers(runtime))

void test('an intermediate update closes below its text with a smaller matching rule', () => {
	const row = new AssistantMessageComponent(
		assistantMessage('Checking the layout.', 'toolUse'),
		true,
	)
	const lines = visible(row.render(80))
	const rules = lines
		.map((line, index) => ({ line, index }))
		.filter(({ line }) => /^\s+─+$/u.test(line))
	assert.equal(rules.length, 2)
	const body = lines.findIndex(line => line.includes('Checking the layout.'))
	assert.ok((rules[0]?.index ?? Infinity) < body)
	assert.ok((rules[1]?.index ?? -1) > body)
	assert.ok(
		(rules[1]?.line.trim().length ?? Infinity) <
			(rules[0]?.line.trim().length ?? 0),
	)
	assert.equal(lines.at(-1), '')
	row.invalidate()
	assert.deepEqual(visible(row.render(80)), lines)
})

void test('mixed commentary and final text close the commentary before the Answer landmark', () => {
	const row = new AssistantMessageComponent(
		assistantMessage([
			{
				type: 'text',
				text: 'Progress.',
				textSignature: '{"v":1,"id":"first","phase":"commentary"}',
			},
			{
				type: 'text',
				text: 'Conclusion.',
				textSignature: '{"v":1,"id":"last","phase":"final_answer"}',
			},
		]),
		true,
	)
	const lines = visible(row.render(80))
	const progress = lines.findIndex(line => line.includes('Progress.'))
	const answer = lines.findIndex(line => line.includes('✦ Answer'))
	assert.equal(
		lines.slice(progress + 1, answer).filter(line => /^\s+─+$/u.test(line))
			.length,
		1,
	)
	assert.equal(
		lines.slice(answer + 1).filter(line => /^\s+─+$/u.test(line)).length,
		0,
	)
})

void test('interruption notices remain inside the intermediate response before its closing rule', () => {
	const row = new AssistantMessageComponent(
		assistantMessage('Partial output.', 'error'),
		true,
	)
	const lines = visible(row.render(80))
	const notice = lines.findIndex(line => line.includes('Error:'))
	const footer = lines.findLastIndex(line => /^\s+─+$/u.test(line))
	assert.ok(notice > 0)
	assert.ok(footer > notice)
})

void test('final answers and thinking-only messages receive no closing rule', () => {
	const final = new AssistantMessageComponent(
		assistantMessage('Complete.'),
		true,
	)
	assert.equal(
		visible(final.render(80)).filter(line => /^\s+─+$/u.test(line)).length,
		0,
	)
	const thinking = new AssistantMessageComponent(
		assistantMessage([
			{ type: 'thinking', thinking: 'Reasoning fixture.' },
		]),
		true,
	)
	assert.equal(
		visible(thinking.render(80)).filter(line => line.includes('─')).length,
		0,
	)
})
