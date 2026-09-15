import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

import { installRenderers } from '../extensions/renderers/install-renderers.ts'

import { complete, runtime, toolRow, visible } from './renderers-fixture.ts'

after(installRenderers(runtime))

for (const name of ['edit', 'write', 'ls']) {
	void test(`${name} puts the filename before its quiet directory without changing original arguments`, () => {
		const args = {
			path: join(homedir(), '.pi/agent/extensions/ui/activity-line.ts'),
		}
		const original = structuredClone(args)
		const row = toolRow(name, args)
		complete(row, 'Updated.')
		const header = visible(row.render(120))[0] ?? ''
		if (name === 'ls') {
			assert.equal(header.slice(6, 15).replace(/\s+/gu, ' '), 'ls 1l')
			assert.match(
				header,
				/activity-line\.ts ~\/\.pi\/agent\/extensions\/ui/u,
			)
		} else {
			assert.ok(
				header.startsWith(
					`┌─ ${name.toUpperCase()} · activity-line.ts`,
				),
			)
			assert.match(
				visible(row.render(120)).join('\n'),
				/~\/\.pi\/agent\/extensions\/ui/u,
			)
		}
		assert.ok(!visible(row.render(120)).join('\n').includes(homedir()))
		assert.deepEqual(args, original)
		row.setExpanded(true)
		assert.ok(visible(row.render(160)).join('\n').includes(args.path))
	})
}
