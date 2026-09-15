import assert from 'node:assert/strict'
import test, { afterEach, beforeEach } from 'node:test'

import {
	AssistantMessageComponent,
	CompactionSummaryMessageComponent,
	getMarkdownTheme,
	ToolExecutionComponent,
} from '@earendil-works/pi-coding-agent'

import { installRenderers } from '../extensions/renderers/install-renderers.ts'

import { click, runtime, visible } from './renderers-fixture.ts'
import { assistantMessage } from './response-fixture.ts'

let dispose: (() => void) | undefined
beforeEach(() => {
	dispose = installRenderers(runtime)
})
afterEach(() => dispose?.())

void test('Markdown transformers retain their width, message-type and streaming contracts', () => {
	const row = new AssistantMessageComponent(
		undefined,
		true,
		undefined,
		'',
		1,
		[
			() => {
				throw new Error('broken transformer')
			},
			(source, context) =>
				`${source}\n\n${context.messageType} / ${context.availableWidth} / ${String(context.isStreaming)}`,
		],
	)
	row.updateContent(assistantMessage('Preserved answer.'), true)
	assert.match(visible(row.render(40)).join('\n'), /assistant \/ 38 \/ true/u)
	row.updateContent(assistantMessage('Preserved answer.'), false)
	assert.match(
		visible(row.render(80)).join('\n'),
		/assistant \/ 78 \/ false/u,
	)
	assert.match(visible(row.render(80)).join('\n'), /Preserved answer/u)
})

void test('rendering, resizing and invalidation never alter stored message content or signatures', () => {
	const message = assistantMessage('## Summary\n\n**Original** evidence.')
	const before = structuredClone(message)
	const row = new AssistantMessageComponent(message, true)
	row.render(80)
	row.render(20)
	row.invalidate()
	assert.deepEqual(message, before)
})

void test('legacy, malformed and unknown signature versions fall back to actual message lifecycle', () => {
	for (const signature of [
		'legacy-id',
		'{broken',
		'{"v":99,"id":"x","phase":"commentary"}',
	]) {
		const row = new AssistantMessageComponent(
			assistantMessage([
				{
					type: 'text',
					text: 'Answer retained.',
					textSignature: signature,
				},
			]),
			true,
		)
		const text = visible(row.render(80)).join('\n')
		assert.match(text, /✦ Answer/u)
		assert.match(text, /Answer retained/u)
	}
})

void test('explicit final metadata can identify an answer while it is still streaming', () => {
	const row = new AssistantMessageComponent()
	row.updateContent(
		assistantMessage([
			{
				type: 'text',
				text: 'Confirmed final phase.',
				textSignature: '{"v":1,"id":"answer","phase":"final_answer"}',
			},
		]),
		true,
	)
	assert.match(visible(row.render(80)).join('\n'), /✦ Answer/u)
})

void test('authored rail glyphs keep their colors in prose but not inside code fences', () => {
	const theme = {
		...getMarkdownTheme(),
		highlightCode: (code: string) => [code],
	}
	const row = new AssistantMessageComponent(
		assistantMessage(
			[
				'├─ ● read source',
				'',
				'```text',
				'├─ ● literal code',
				'```',
			].join('\n'),
		),
		true,
		theme,
	)
	const lines = row.render(80)
	const prose = lines.find(line => line.includes('read source')) ?? ''
	const code = lines.find(line => line.includes('literal code')) ?? ''
	assert.match(prose, /\u001b\[38;2;64;160;43m●/u)
	assert.doesNotMatch(code, /\u001b\[38;2;64;160;43m/u)
	assert.match(code, /literal code/u)
})

void test('thinking runs separated by invisible content keep independent mouse controls', () => {
	for (const barrier of [
		{ type: 'text', text: '' },
		{ type: 'toolCall', id: 't', name: 'read', arguments: {} },
	] as const) {
		const row = new AssistantMessageComponent(
			assistantMessage([
				{ type: 'thinking', thinking: 'First reasoning.' },
				barrier,
				{ type: 'thinking', thinking: '' },
				{ type: 'thinking', thinking: 'Second reasoning.' },
			]),
			true,
		)
		assert.equal(
			visible(row.render(80)).filter(line => line.includes('▸ Thinking'))
				.length,
			2,
		)
		row.handleMouse(click())
		const firstExpanded = visible(row.render(80))
		assert.match(firstExpanded.join('\n'), /First reasoning/u)
		assert.doesNotMatch(firstExpanded.join('\n'), /Second reasoning/u)
		row.handleMouse(
			click(firstExpanded.findIndex(line => line.includes('▸ Thinking'))),
		)
		assert.match(visible(row.render(80)).join('\n'), /Second reasoning/u)
		row.handleMouse(click())
		const secondExpanded = visible(row.render(80)).join('\n')
		assert.doesNotMatch(secondExpanded, /First reasoning/u)
		assert.match(secondExpanded, /Second reasoning/u)
	}
})

void test('a missing assistant surface rolls back already-installed tool and compaction patches', () => {
	dispose?.()
	const before = AssistantMessageComponent.prototype.updateContent
	const toolRender = ToolExecutionComponent.prototype.render
	const compactRender = CompactionSummaryMessageComponent.prototype.render
	assert.throws(
		() =>
			installRenderers({
				VERSION: '0.85.1',
				ToolExecutionComponent,
				CompactionSummaryMessageComponent,
			}),
		/all patches rolled back/u,
	)
	assert.equal(AssistantMessageComponent.prototype.updateContent, before)
	assert.equal(ToolExecutionComponent.prototype.render, toolRender)
	assert.equal(
		CompactionSummaryMessageComponent.prototype.render,
		compactRender,
	)
	const reinstall = installRenderers(runtime)
	const row = new AssistantMessageComponent(
		assistantMessage('Restored presentation.'),
		true,
	)
	assert.equal(
		visible(row.render(80)).filter(line => line.includes('✦ Answer'))
			.length,
		1,
	)
	reinstall()
})
