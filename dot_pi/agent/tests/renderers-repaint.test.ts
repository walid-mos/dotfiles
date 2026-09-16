import assert from 'node:assert/strict'
import test from 'node:test'

import { installRenderers } from '../extensions/renderers/install-renderers.ts'

import {
	ManualActivityTime,
	runtime,
	toolRow,
	visible,
} from './renderers-fixture.ts'

void test('the activity pulse keeps a running row refreshing', () => {
	const time = new ManualActivityTime()
	const dispose = installRenderers(runtime, time.clock)
	try {
		const row = toolRow('bash', { command: 'sleep 10' })
		row.markExecutionStarted()
		const [first] = visible(row.render(100))
		time.advance(360)
		const [second] = visible(row.render(100))
		assert.notEqual(
			second,
			first,
			'a running row must be invalidated by the pulse, not served from reused lines',
		)
		assert.match(second ?? '', /0\.4s/u)
	} finally {
		dispose()
	}
})

void test('a settled row stops driving the pulse', () => {
	const time = new ManualActivityTime()
	const dispose = installRenderers(runtime, time.clock)
	try {
		const row = toolRow('bash', { command: 'echo done' })
		row.markExecutionStarted()
		row.render(100)
		assert.equal(time.isScheduled, true, 'a running row animates')
		row.updateResult({
			content: [{ type: 'text', text: 'done' }],
			isError: false,
		})
		row.render(100)
		assert.equal(
			time.isScheduled,
			false,
			'a settled row must not leave a repaint timer behind',
		)
	} finally {
		dispose()
	}
})
