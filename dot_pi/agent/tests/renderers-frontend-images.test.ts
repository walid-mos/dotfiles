import assert from 'node:assert/strict'
import test from 'node:test'

import { getCapabilities, setCapabilities } from '@earendil-works/pi-tui'

import { installRenderers } from '../extensions/renderers/install-renderers.ts'

import { png } from './png-fixture.ts'
import { runtime, toolRow } from './renderers-fixture.ts'

for (const name of ['frontend_open', 'frontend_act', 'frontend_screenshot']) {
	void test(`${name} shows its screenshot without expanding tool details`, () => {
		const capabilities = { ...getCapabilities() }
		setCapabilities({ ...capabilities, images: 'iterm2' })
		const dispose = installRenderers(runtime)
		try {
			const row = toolRow(name)
			const outcome = {
				content: [
					{ type: 'text', text: 'Private expanded detail' },
					{
						type: 'image',
						mimeType: 'image/png',
						data: png(2, 2, () => [255, 0, 0, 255]),
					},
				],
				isError: false,
			}
			const original = structuredClone(outcome)
			row.updateResult(outcome)
			assert.match(row.render(80).join('\n'), /1337;File/u)
			assert.doesNotMatch(
				row.render(80).join('\n'),
				/Private expanded detail/u,
			)
			row.setExpanded(true)
			assert.equal(
				row.render(80).filter(line => line.includes('1337;File'))
					.length,
				1,
			)
			row.setExpanded(false)
			assert.match(row.render(80).join('\n'), /1337;File/u)
			row.setShowImages(false)
			assert.doesNotMatch(row.render(80).join('\n'), /1337;File/u)
			assert.equal(row.render(80).length, 1)
			assert.deepEqual(outcome, original)
		} finally {
			dispose()
			setCapabilities(capabilities)
		}
	})
}
