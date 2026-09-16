import assert from 'node:assert/strict'
import test, { after } from 'node:test'

import { AssistantMessageComponent } from '@earendil-works/pi-coding-agent'
import { Spacer, Text } from '@earendil-works/pi-tui'

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

void test('the last collapsed tool closes its rail before an interruption notice', () => {
	const bash = toolRow('bash', { command: 'pnpm test' })
	const read = toolRow('read', { path: 'file.ts' })
	complete(bash)
	complete(read)
	const transcript = toolTranscript([
		bash,
		read,
		new Spacer(1),
		new Text('Operation aborted', 0, 0),
	])
	const lines = visible(transcript.render(80))
	assert.match(lines[0] ?? '', /^├─/u)
	assert.match(lines[1] ?? '', /^╰─/u)
	assert.equal(lines[2], '')
	assert.equal(lines[3], 'Operation aborted')
	assert.equal(lines.length, 4)
})

void test('the closing branch follows appended, removed and remounted tool calls', () => {
	const first = toolRow('bash')
	const last = toolRow('read')
	const transcript = toolTranscript([first])
	assert.match(visible(transcript.render(80))[0] ?? '', /^╰─/u)
	transcript.addChild(last)
	assert.deepEqual(
		visible(transcript.render(80)).map(line => line[0]),
		['├', '╰'],
	)
	transcript.removeChild(last)
	assert.match(visible(transcript.render(80))[0] ?? '', /^╰─/u)
	const remounted = toolTranscript([last, first])
	assert.deepEqual(
		visible(remounted.render(80)).map(line => line[0]),
		['├', '╰'],
	)
})

void test('invisible tool-call messages preserve continuity while visible notices end the group', () => {
	const invisible = new AssistantMessageComponent(
		assistantMessage(
			[{ type: 'toolCall', id: 'next', name: 'read', arguments: {} }],
			'toolUse',
		),
		true,
	)
	const transcript = toolTranscript([
		toolRow('bash'),
		invisible,
		toolRow('read'),
		new Text('Notice', 0, 0),
		toolRow('grep'),
	])
	const lines = visible(transcript.render(80))
	assert.deepEqual(
		lines.map(line => line[0]),
		['├', '╰', 'N', '╰'],
	)
})

void test('hidden thinking between batches does not create extra tool-chain endings', () => {
	const hidden = new AssistantMessageComponent(
		assistantMessage(
			[
				{ type: 'thinking', thinking: 'Continue checking.' },
				{
					type: 'toolCall',
					id: 'next-batch',
					name: 'read',
					arguments: {},
				},
			],
			'toolUse',
		),
		true,
	)
	hidden.setHiddenThinkingLabel('')
	assert.deepEqual(visible(hidden.render(80)), [])
	const transcript = toolTranscript([
		toolRow('bash'),
		hidden,
		toolRow('read'),
	])
	assert.deepEqual(
		visible(transcript.render(80)).map(line => line[0]),
		['├', '╰'],
	)
})

void test('intermediate updates and failed tools stay in the chain until the final answer', () => {
	const failed = toolRow('bash')
	failed.updateResult({
		content: [{ type: 'text', text: 'Command exited with code 1' }],
		isError: true,
	})
	const update = new AssistantMessageComponent(
		assistantMessage('Trying the correction.', 'toolUse'),
		true,
	)
	const final = new AssistantMessageComponent(
		assistantMessage('Finished.'),
		true,
	)
	const transcript = toolTranscript([
		failed,
		update,
		toolRow('read'),
		final,
		toolRow('write'),
	])
	const lines = visible(transcript.render(80))
	const headers = lines.filter(line => /^[├╰]/u.test(line))
	assert.deepEqual(
		headers.map(line => line[0]),
		['├', '╰'],
	)
	assert.match(headers[0] ?? '', /✕/u)
	assert.ok(lines.some(line => line.startsWith('┌─   WRITE')))
})

void test('closing branches preserve row widths and expanded detail rails without arrows', () => {
	const row = toolRow('read', { path: 'file.ts' })
	complete(row)
	const transcript = toolTranscript([row])
	for (const width of [0, 1, 8, 48, 80, 120]) {
		const lines = transcript.render(width)
		assert.equal(lines.length, 1)
		assert.ok(terminalLineWidth(lines[0] ?? '') <= width)
	}
	row.setExpanded(true)
	const expanded = visible(transcript.render(80))
	assert.match(expanded[0] ?? '', /^├─/u)
	assert.doesNotMatch(expanded[0] ?? '', /[▸▾]/u)
	assert.ok(expanded.slice(1).some(line => line.startsWith('│')))
	row.setExpanded(false)
	assert.match(visible(transcript.render(80))[0] ?? '', /^╰─/u)
	assert.doesNotMatch(visible(transcript.render(80))[0] ?? '', /[▸▾]/u)
})
