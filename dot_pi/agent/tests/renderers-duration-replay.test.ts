import assert from 'node:assert/strict'
import test from 'node:test'

import { installRenderers } from '../extensions/renderers/install-renderers.ts'

import {
	ManualActivityTime,
	runtime,
	toolRow,
	visible,
} from './renderers-fixture.ts'

void test('recorded duration survives renderer reinstall and native replay without mutating the result', () => {
	const time = new ManualActivityTime()
	const dispose = installRenderers(runtime, time.clock)
	const toolResult = {
		content: [{ type: 'text' as const, text: 'Completed.' }],
		isError: false,
	}
	const original = structuredClone(toolResult)
	const row = toolRow('bash', { command: 'test' })
	row.markExecutionStarted()
	time.advance(2400)
	row.updateResult(toolResult)
	assert.match(visible(row.render(100))[0] ?? '', /2\.4s/u)
	dispose()

	const later = new ManualActivityTime()
	later.advance(60000)
	const restore = installRenderers(runtime, later.clock)
	try {
		row.invalidate()
		assert.match(visible(row.render(100))[0] ?? '', /2\.4s/u)
		// Pi replay reconstructs the result wrapper but keeps the session content array.
		const replayed = toolRow('bash', { command: 'test' })
		replayed.updateResult({ ...toolResult })
		assert.match(visible(replayed.render(100))[0] ?? '', /2\.4s/u)
		assert.deepEqual(toolResult, original)
		assert.equal(later.isScheduled, false)

		const unrelated = toolRow('bash', { command: 'test' })
		unrelated.updateResult(structuredClone(toolResult))
		assert.doesNotMatch(visible(unrelated.render(100))[0] ?? '', /\d\.\ds/u)
		const sharedContent = toolRow('read', { path: 'file.ts' })
		sharedContent.updateResult(toolResult)
		assert.doesNotMatch(
			visible(sharedContent.render(100))[0] ?? '',
			/\d\.\ds/u,
		)
	} finally {
		restore()
	}
})
