import assert from 'node:assert/strict'
import test, { after } from 'node:test'

import { AssistantMessageComponent } from '@earendil-works/pi-coding-agent'

import { installRenderers } from '../extensions/renderers/install-renderers.ts'
import { ActivityNotice } from '../extensions/ui/activity-notice.ts'
import { uiTheme } from '../extensions/ui/design-system/theme.ts'
import { terminalLineWidth } from '../extensions/ui/terminal-text.ts'

import { complete, runtime, toolRow, visible } from './renderers-fixture.ts'
import { assistantMessage } from './response-fixture.ts'

after(installRenderers(runtime))

void test('model error text aligns with tool names in compact and airy layouts', () => {
	const message = assistantMessage('', 'error')
	message.errorMessage = 'WebSocket error'
	const original = structuredClone(message)
	const error = new AssistantMessageComponent(message, true)
	const read = toolRow('read', { path: 'file.ts' })
	complete(read)
	for (const width of [40, 64, 80, 120]) {
		const line =
			visible(error.render(width)).find(renderedLine =>
				renderedLine.includes('Error:'),
			) ?? ''
		const tool = visible(read.render(width))[0] ?? ''
		assert.equal(line.indexOf('Error:'), tool.indexOf('read'))
		assert.equal(line.indexOf('✕'), tool.indexOf('✓'))
		assert.ok(line.includes('Error: WebSocket error'))
	}
	assert.deepEqual(message, original)
})

void test('errors stand out with a bold red marker and message rather than tool-body ink', () => {
	const line =
		new ActivityNotice('Error: WebSocket error', 'danger').render(80)[0] ??
		''
	assert.ok(line.includes(uiTheme.bold(uiTheme.fg('danger', '✕'))))
	assert.ok(
		line.includes(
			uiTheme.bold(uiTheme.fg('danger', 'Error: WebSocket error')),
		),
	)
	assert.ok(!line.includes(uiTheme.fg('output', 'Error: WebSocket error')))
	assert.doesNotMatch(visible([line])[0] ?? '', /[├╰│▸▾]/u)
})

void test('wrapped errors retain their full details with hanging indentation', () => {
	const text =
		'Error: WebSocket disconnected. Retry after reconnecting.\nRequest abcdefghijklmnopqrstuvwxyz0123456789'
	const lines = visible(new ActivityNotice(text, 'danger').render(32))
	assert.ok(lines.length > 2)
	assert.ok(lines.slice(1).every(line => line.startsWith('     ')))
	const content = lines.join('').replace(/[✕\s]/gu, '')
	assert.equal(content, text.replace(/\s/gu, ''))
})

void test('warning notices share alignment and all notice widths stay bounded', () => {
	const notice = new ActivityNotice('Operation aborted', 'warning')
	assert.ok(
		(notice.render(80)[0] ?? '').includes(
			uiTheme.bold(uiTheme.fg('warning', 'Operation aborted')),
		),
	)
	assert.match(
		visible(notice.render(80))[0] ?? '',
		/^ {4}! Operation aborted$/u,
	)
	for (let width = 0; width <= 100; width++) {
		const lines = new ActivityNotice(
			'Error: Connection failed 界 🌍\nPlease retry.',
			'danger',
		).render(width)
		assert.ok(lines.every(line => terminalLineWidth(line) <= width))
	}
})
