import assert from 'node:assert/strict'
import test from 'node:test'

import { Text } from '@earendil-works/pi-tui'

import { installRenderers } from '../extensions/renderers/install-renderers.ts'

import { complete, runtime, toolRow, visible } from './renderers-fixture.ts'

void test('a plugin returning an invalid component cannot swallow its tool output', () => {
	const dispose = installRenderers(runtime)
	try {
		const plugin = { renderResult: () => new Text('valid', 0, 0) }
		// An untyped package can return undefined despite the TypeScript contract.
		Reflect.set(plugin, 'renderResult', () => undefined)
		const row = toolRow('malformed_plugin', {}, plugin)
		complete(row, 'Evidence must survive')
		row.setExpanded(true)
		assert.ok(
			visible(row.render(80)).includes('│    Evidence must survive'),
		)
	} finally {
		dispose()
	}
})
