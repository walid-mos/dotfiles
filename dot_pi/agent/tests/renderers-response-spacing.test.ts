import assert from 'node:assert/strict'
import test, { after } from 'node:test'

import { AssistantMessageComponent } from '@earendil-works/pi-coding-agent'
import { Container } from '@earendil-works/pi-tui'

import { installRenderers } from '../extensions/renderers/install-renderers.ts'

import { complete, runtime, toolRow, visible } from './renderers-fixture.ts'
import { assistantMessage } from './response-fixture.ts'

after(installRenderers(runtime))

for (const { label, source } of [
	{ label: 'paragraph', source: '**Ready.**' },
	{ label: 'list', source: '- Ready\n- Verified' },
	{ label: 'code', source: '```ts\nconst ready = true;\n```' },
	{ label: 'quote', source: '> Ready.' },
	{
		label: 'table',
		source: '| Check | Status |\n| --- | --- |\n| Tests | Passed |',
	},
]) {
	void test(`${label} responses have one blank line above and below beside tool calls`, () => {
		const read = toolRow('read', { path: 'a.ts' })
		const bash = toolRow('bash', { command: 'test' })
		complete(read)
		complete(bash)
		for (const reason of ['stop', 'toolUse', 'error'] as const) {
			const transcript = new Container()
			transcript.addChild(read)
			transcript.addChild(
				new AssistantMessageComponent(
					assistantMessage(source, reason),
					true,
				),
			)
			transcript.addChild(bash)
			const lines = visible(transcript.render(80))
			assert.match(lines[0] ?? '', /^├─+ +✓ +read/u)
			assert.equal(lines[1], '')
			assert.match(lines[2] ?? '', /─/u)
			assert.equal(lines.at(-2), '')
			assert.notEqual(lines.at(-3), '')
			assert.match(lines.at(-1) ?? '', /^├─+ +✓ +bash/u)
		}
	})
}
