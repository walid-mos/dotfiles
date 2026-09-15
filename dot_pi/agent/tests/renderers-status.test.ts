import assert from 'node:assert/strict'
import test, { after } from 'node:test'

import { installRenderers } from '../extensions/renderers/install-renderers.ts'

import { runtime, toolRow, visible } from './renderers-fixture.ts'

after(installRenderers(runtime))

void test('a failed test suite reporting cancelled 0 is an error, not a cancelled command', () => {
	const row = toolRow('bash', { command: 'node --test' })
	row.updateResult({
		isError: true,
		content: [
			{
				type: 'text',
				text: [
					'ℹ tests 320',
					'ℹ fail 1',
					'ℹ cancelled 0',
					'Command exited with code 1',
				].join('\n'),
			},
		],
	})
	assert.match(visible(row.render(100))[0] ?? '', /^├─+ +✕ +bash.*exit 1/u)
})

void test('the terminal exit status wins over an earlier exit code printed by the command', () => {
	const row = toolRow('bash', { command: 'run-tests' })
	row.updateResult({
		isError: true,
		content: [
			{
				type: 'text',
				text: 'Previous run: exit code: 0\nRequest was canceled in a test\nCommand exited with code 7',
			},
		],
	})
	assert.match(visible(row.render(100))[0] ?? '', /^├─+ +✕ +bash.*exit 7/u)
})

void test('a real terminal abort remains cancellation even when preceding output mentions exit codes', () => {
	const row = toolRow('bash', { command: 'long-running-tests' })
	row.updateResult({
		isError: true,
		content: [
			{
				type: 'text',
				text: 'Test fixture: exit code: 1\nCommand aborted',
			},
		],
	})
	assert.match(visible(row.render(100))[0] ?? '', /^├─+ +⊘ +bash.*cancelled/u)
})
