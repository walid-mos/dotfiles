import assert from 'node:assert/strict'
import test, { after } from 'node:test'

import { Text } from '@earendil-works/pi-tui'

import { installRenderers } from '../extensions/renderers/install-renderers.ts'
import { uiTheme } from '../extensions/ui/design-system/theme.ts'
import { terminalLineWidth } from '../extensions/ui/terminal-text.ts'

import {
	click,
	complete,
	ManualActivityTime,
	runtime,
	toolRow,
	toolTranscript,
	visible,
} from './renderers-fixture.ts'

const time = new ManualActivityTime()
after(installRenderers(runtime, time.clock))

for (const scenario of [
	{ phase: 'queued', label: 'Preparing' },
	{ phase: 'running', label: 'Applying' },
	{ phase: 'success', label: 'Applied' },
	{ phase: 'error', label: 'Failed' },
	{ phase: 'cancelled', label: 'Cancelled' },
]) {
	void test(`write has its own panel during ${scenario.phase}, not the observation-tool row`, () => {
		const row = toolRow('write', {
			path: 'src/file.ts',
			content: 'const value = 1;\n',
		})
		if (scenario.phase !== 'queued') row.markExecutionStarted()
		if (scenario.phase === 'success') complete(row)
		if (scenario.phase === 'error' || scenario.phase === 'cancelled')
			row.updateResult({
				content: [
					{
						type: 'text',
						text:
							scenario.phase === 'error'
								? 'Write failed'
								: 'Operation aborted',
					},
				],
				isError: true,
			})
		const lines = row.render(100)
		const plain = visible(lines)
		assert.match(plain[0] ?? '', /^┌─ WRITE · file\.ts .*┐$/u)
		assert.ok(plain[1]?.includes(scenario.label))
		assert.ok(lines[0]?.includes(uiTheme.fg('mutationBorder', '┌─ ')))
		assert.match(plain.at(-1) ?? '', /^└─.*┘$/u)
		assert.ok(plain.every(line => !/^[├╰]/u.test(line)))
		for (let width = 0; width <= 100; width++)
			assert.ok(
				row
					.render(width)
					.every(line => terminalLineWidth(line) <= width),
			)
		if (scenario.phase === 'running') complete(row)
	})
}

void test('parent-container clicks at the same code position open and fold without offset errors', () => {
	const row = toolRow('write', {
		path: 'file.ts',
		content: Array(20).fill('const value = 1;').join('\n'),
	})
	complete(row)
	const transcript = toolTranscript([new Text('Earlier context', 0, 0), row])
	const before = transcript.render(100)
	assert.equal(transcript.handleMouse(click(4))?.handled, true)
	const expanded = transcript.render(100)
	assert.ok(expanded.length > before.length)
	assert.equal(transcript.handleMouse(click(4))?.handled, true)
	assert.deepEqual(transcript.render(100), before)
})

void test('a running file panel updates its existing timing strip without adding rows', () => {
	const row = toolRow('edit', { path: 'file.ts' })
	row.markExecutionStarted()
	const before = row.render(100)
	time.advance(1200)
	const during = row.render(100)
	assert.equal(during.length, before.length)
	assert.match(visible(during)[1] ?? '', /Applying.*1\.2s/u)
	assert.equal(during[0], before[0])
	complete(row)
})
