import assert from 'node:assert/strict'
import test, { after } from 'node:test'

import { AssistantMessageComponent } from '@earendil-works/pi-coding-agent'
import { visibleWidth } from '@earendil-works/pi-tui'

import { installRawTranscriptPatches } from '../extensions/raw-transcript/index.ts'
import { installRenderers } from '../extensions/renderers/install-renderers.ts'

import { click, runtime, visible } from './renderers-fixture.ts'
import { assistantMessage } from './response-fixture.ts'

after(installRenderers(runtime))

void test('a final answer has one accented bold title and renders emphasis rather than raw Markdown', () => {
	const row = new AssistantMessageComponent(
		assistantMessage('**Important** result.\n\nNext paragraph.'),
		true,
	)
	const lines = row.render(80)
	const titles = lines.filter(line => line.includes('✦ Answer'))
	assert.equal(titles.length, 1)
	assert.match(titles[0] ?? '', /\u001b\[1m/u)
	assert.match(titles[0] ?? '', /\u001b\[38;2;136;57;239m/u)
	assert.ok(visible(lines).some(line => line.trim() === 'Important result.'))
	assert.doesNotMatch(visible(lines).join('\n'), /\*\*Important\*\*/u)
	assert.ok(visible(lines).includes(''))
})

void test('streaming fallback retires its footer without moving the body or duplicating the final title', () => {
	const row = new AssistantMessageComponent()
	const message = assistantMessage('A readable answer.')
	row.updateContent(message, true)
	const during = row.render(80)
	assert.doesNotMatch(visible(during).join('\n'), /✦ Answer/u)
	assert.ok(visible(during).some(line => /─/u.test(line)))
	row.updateContent(message, false)
	const settled = row.render(80)
	assert.equal(during.length - settled.length, 2)
	assert.equal(
		visible(settled).findIndex(line => line.includes('A readable answer.')),
		visible(during).findIndex(line => line.includes('A readable answer.')),
	)
	assert.equal(settled.filter(line => line.includes('✦ Answer')).length, 1)
	row.invalidate()
	assert.deepEqual(row.render(80), settled)
})

void test('tool-calling updates retain a muted divider, not a final-answer title', () => {
	const row = new AssistantMessageComponent(
		assistantMessage(
			[
				{ type: 'text', text: 'Checking the implementation.' },
				{
					type: 'toolCall',
					id: 'read-1',
					name: 'read',
					arguments: { path: 'a.ts' },
				},
			],
			'toolUse',
		),
		true,
	)
	const lines = visible(row.render(80))
	assert.doesNotMatch(lines.join('\n'), /✦ Answer/u)
	assert.ok(lines.some(line => /^\s+─+$/u.test(line)))
	assert.ok(lines.some(line => line.includes('Checking the implementation.')))
})

void test('provider commentary and final answer remain distinct sections within one saved message', () => {
	const row = new AssistantMessageComponent(
		assistantMessage([
			{
				type: 'text',
				text: 'Working update.',
				textSignature: '{"v":1,"id":"first","phase":"commentary"}',
			},
			{
				type: 'text',
				text: 'The conclusion.',
				textSignature: '{"v":1,"id":"last","phase":"final_answer"}',
			},
		]),
		true,
	)
	const lines = visible(row.render(80))
	assert.equal(lines.filter(line => line.includes('✦ Answer')).length, 1)
	assert.ok(
		lines.findIndex(line => line.includes('Working update.')) <
			lines.findIndex(line => line.includes('✦ Answer')),
	)
	assert.ok(
		lines.findIndex(line => line.includes('✦ Answer')) <
			lines.findIndex(line => line.includes('The conclusion.')),
	)
})

void test('commentary metadata wins over a successful stop reason', () => {
	const message = assistantMessage([
		{
			type: 'text',
			text: 'Progress only.',
			textSignature: '{"v":1,"id":"update","phase":"commentary"}',
		},
	])
	const row = new AssistantMessageComponent(message, true)
	assert.doesNotMatch(visible(row.render(80)).join('\n'), /✦ Answer/u)
})

void test('interrupted output remains visible and never receives a final-answer label', () => {
	for (const reason of ['length', 'error', 'aborted'] as const) {
		const row = new AssistantMessageComponent(
			assistantMessage(
				[
					{
						type: 'text',
						text: 'Partial result.',
						textSignature:
							'{"v":1,"id":"partial","phase":"final_answer"}',
					},
				],
				reason,
			),
			true,
		)
		const text = visible(row.render(80)).join('\n')
		assert.match(text, /Partial result\./u)
		assert.doesNotMatch(text, /✦ Answer/u)
		assert.match(text, /truncated|Error:|interrupted/u)
	}
})

void test('empty/tool-only responses create no decorative noise', () => {
	for (const message of [
		assistantMessage('  '),
		assistantMessage(
			[{ type: 'toolCall', id: 'r', name: 'read', arguments: {} }],
			'toolUse',
		),
	]) {
		assert.deepEqual(
			new AssistantMessageComponent(message, true).render(80),
			[],
		)
	}
})

void test('headings, code, links, lists and wide graphemes survive bounded rendering', () => {
	const row = new AssistantMessageComponent(
		assistantMessage(
			[
				'## Results',
				'',
				'- **Ready**',
				'- `api.ts`',
				'',
				'[Docs](https://example.com)',
				'',
				'```ts',
				'const family = "👨\u200d👩\u200d👧\u200d👦界";',
				'```',
			].join('\n'),
		),
		true,
	)
	for (const width of [0, 1, 2, 8, 20, 80]) {
		assert.ok(row.render(width).every(line => visibleWidth(line) <= width))
	}
	const text = visible(row.render(80)).join('\n')
	assert.match(text, /Results/u)
	assert.match(text, /const family/u)
	assert.match(text, /👨\u200d👩\u200d👧\u200d👦界/u)
	assert.match(text, /Docs/u)
	assert.match(text, /api\.ts/u)
})

void test('thinking visibility and mouse expansion survive the assistant adapter', () => {
	const row = new AssistantMessageComponent(
		assistantMessage([
			{ type: 'thinking', thinking: 'A visible reasoning fixture.' },
			{ type: 'text', text: 'The answer.' },
		]),
		true,
	)
	assert.doesNotMatch(
		visible(row.render(80)).join('\n'),
		/reasoning fixture/u,
	)
	row.handleMouse(click())
	assert.match(visible(row.render(80)).join('\n'), /reasoning fixture/u)
	row.setHideThinkingBlock(true)
	assert.doesNotMatch(
		visible(row.render(80)).join('\n'),
		/reasoning fixture/u,
	)
	row.setHideThinkingBlock(false)
	assert.match(visible(row.render(80)).join('\n'), /reasoning fixture/u)
})

void test('raw user styling cannot reclaim assistant rendering during reload', async () => {
	await installRawTranscriptPatches()
	const row = new AssistantMessageComponent(
		assistantMessage('**Still styled**'),
		true,
	)
	const text = visible(row.render(80)).join('\n')
	assert.match(text, /✦ Answer/u)
	assert.doesNotMatch(text, /\*\*Still styled\*\*/u)
})
