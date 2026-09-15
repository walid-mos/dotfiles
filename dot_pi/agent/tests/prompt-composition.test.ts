/** Prompt/tool/answer alignment through the real transcript container. */
import assert from 'node:assert/strict'
import test, { after } from 'node:test'

import {
	AssistantMessageComponent,
	UserMessageComponent,
} from '@earendil-works/pi-coding-agent'

import { installRawTranscriptPatches } from '../extensions/raw-transcript/index.ts'
import { installRenderers } from '../extensions/renderers/install-renderers.ts'
import { terminalLineWidth } from '../extensions/ui/terminal-text.ts'

import {
	complete,
	runtime,
	toolRow,
	toolTranscript,
	visible,
} from './renderers-fixture.ts'
import { assistantMessage } from './response-fixture.ts'

after(installRenderers(runtime))
after(await installRawTranscriptPatches())

for (const width of [24, 80, 120]) {
	void test(`prompt edges align with tools and preserve answer hierarchy at ${String(width)} columns`, () => {
		const read = toolRow('read', { path: 'src/app.ts' })
		complete(read)
		const transcript = toolTranscript([
			new UserMessageComponent('Inspect the layout.'),
			read,
			new AssistantMessageComponent(
				assistantMessage('**Ready.**'),
				true,
				undefined,
				undefined,
				0,
			),
		])
		const rendered = transcript.render(width)
		const lines = visible(rendered)
		const top = lines.find(line => line.startsWith('╭')) ?? ''
		const tool = lines.find(line => /^[├╰]─+ +✓ +read\b/u.test(line)) ?? ''
		const toolIndex = lines.indexOf(tool)
		assert.match(top, /^╭─ ❯ Prompt/u)
		assert.equal(terminalLineWidth(top), width)
		assert.equal(terminalLineWidth(rendered[toolIndex] ?? ''), width)
		assert.doesNotMatch(tool, /[▸▾]/u)
		assert.match(tool, /^╰─/u)
		assert.equal(lines[toolIndex - 1], '')
		assert.equal(lines[toolIndex + 1], '')
		assert.ok(lines.some(line => line.includes('Answer')))
		assert.ok(lines.includes('Ready.'))
		assert.ok(lines.every(line => terminalLineWidth(line) <= width))
	})
}

void test('a submitted prompt closes the preceding tool chain without absorbing the next chain', () => {
	const transcript = toolTranscript([
		toolRow('bash'),
		new UserMessageComponent('Change direction.'),
		toolRow('read'),
	])
	const lines = visible(transcript.render(80))
	const tools = lines.filter(line =>
		/^[├╰]─+ +\S +(?:bash|read)\b/u.test(line),
	)
	assert.equal(tools.length, 2)
	assert.ok(tools.every(line => line.startsWith('╰──')))
	assert.equal(lines.filter(line => line.startsWith('╭─ ❯ Prompt')).length, 1)
})
