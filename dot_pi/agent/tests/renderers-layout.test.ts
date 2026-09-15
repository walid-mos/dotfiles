import assert from 'node:assert/strict'
import test, { after } from 'node:test'

import { visibleWidth } from '@earendil-works/pi-tui'

import { installRenderers } from '../extensions/renderers/install-renderers.ts'

import { complete, runtime, toolRow, visible } from './renderers-fixture.ts'

after(installRenderers(runtime))

void test('narrow layouts clip long failure explanations rather than remove them', () => {
	const row = toolRow('read', { path: 'missing.ts' })
	row.updateResult({
		isError: true,
		content: [
			{
				type: 'text',
				text: `ENOENT: no such file or directory: ${'long/path/'.repeat(20)}`,
			},
		],
	})
	for (const width of [40, 80]) {
		const lines = row.render(width)
		assert.equal(lines.length, 1)
		assert.match(visible(lines)[0] ?? '', /ENOENT/u)
		assert.match(visible(lines)[0] ?? '', /error$/u)
		assert.ok(visibleWidth(lines[0] ?? '') <= width)
	}
})

void test('long fallback tool names leave room for the task without a disclosure control', () => {
	const row = toolRow('very_long_mcp_namespace_tool_name'.repeat(5), {
		action: 'inspect',
	})
	complete(row)
	for (const width of [20, 40, 80]) {
		assert.match(visible(row.render(width))[0] ?? '', /inspect/u)
		assert.doesNotMatch(visible(row.render(width))[0] ?? '', /[▸▾]/u)
		assert.ok(visibleWidth(row.render(width)[0] ?? '') <= width)
	}
})

void test('failed and cancelled truncated output keeps its warning independently of status', () => {
	for (const text of [
		'partial output\nCommand exited with code 1',
		'partial output\nCommand aborted',
		`ENOENT: no such file or directory: ${'long/path/'.repeat(20)}`,
	]) {
		const row = toolRow('bash', { command: 'large-output' })
		row.updateResult({
			isError: true,
			content: [{ type: 'text', text }],
			details: { truncation: { truncated: true } },
		})
		assert.match(visible(row.render(100))[0] ?? '', /truncated/u)
	}
})

for (const { name, details, warning } of [
	{
		name: 'find',
		details: { resultLimitReached: 100 },
		warning: 'limit reached',
	},
	{
		name: 'ls',
		details: { entryLimitReached: 100 },
		warning: 'limit reached',
	},
	{ name: 'grep', details: { linesTruncated: true }, warning: 'truncated' },
]) {
	void test(`${name} preserves its pinned native limit metadata`, () => {
		const row = toolRow(name, { path: 'src', pattern: '*.ts' })
		row.updateResult({
			isError: false,
			content: [{ type: 'text', text: 'one' }],
			details,
		})
		assert.ok((visible(row.render(100))[0] ?? '').includes(warning))
	})
}

void test('async subagent launches are visibly distinct from foreground completion', () => {
	const background = toolRow('subagent', { agent: 'reviewer', async: true })
	complete(background, 'Detached run started')
	assert.match(
		visible(background.render(100))[0] ?? '',
		/✓.*async\s+reviewer/u,
	)
	const foreground = toolRow('subagent', { agent: 'reviewer', async: false })
	complete(foreground, 'Review complete')
	assert.doesNotMatch(
		visible(foreground.render(100))[0] ?? '',
		/async|launched/u,
	)
})
