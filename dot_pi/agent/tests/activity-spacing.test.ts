import assert from 'node:assert/strict'
import test from 'node:test'
import { stripVTControlCharacters } from 'node:util'

import { renderActivityLine } from '../extensions/ui/activity-line.ts'
import { uiTheme } from '../extensions/ui/design-system/theme.ts'

import type { ActivityLine } from '../extensions/ui/activity-line.ts'

const readView: ActivityLine = {
	label: 'read',
	subject: 'file.ts',
	annotation: 'L1-10',
	summary: '10l',
	phase: 'success',
	elapsedMs: 1200,
}

void test('tool and count form one compact identity, not separately padded columns', () => {
	const line = stripVTControlCharacters(renderActivityLine(readView, 80, 0))
	assert.match(line, /^├── ✓ read  10l  file\.ts L1-10/u)
	assert.equal(line.indexOf('10l'), 12)
	assert.equal(line.indexOf('file.ts'), 17)
	assert.ok(line.endsWith('1.2s'))
	assert.equal(line.length, 80)
	assert.doesNotMatch(line, /[\r\n▸▾]/u)
})

void test('compact rows right-align counts without widening the identity', () => {
	const line = stripVTControlCharacters(renderActivityLine(readView, 64, 0))
	assert.match(line, /^├─ ✓ read  10l  file\.ts L1-10/u)
	assert.equal(line.indexOf('file.ts'), 16)
	assert.ok(line.endsWith('1.2s'))
	assert.equal(line.length, 64)
})

void test('counts of different lengths share a right edge and keep the task aligned', () => {
	for (const summary of ['1l', '12l', '120l', '1img']) {
		const line = stripVTControlCharacters(
			renderActivityLine({ ...readView, summary }, 80, 0),
		)
		assert.equal(line.indexOf(summary) + summary.length, 15)
		assert.equal(line.indexOf('file.ts'), 17)
		assert.equal(line.slice(6, 10), 'read')
	}
})

void test('unobserved replay leaves timing empty instead of inventing a duration', () => {
	const subject = 'pnpm run verify --filter workspace --no-cache'
	const line = stripVTControlCharacters(
		renderActivityLine(
			{ ...readView, subject, annotation: '', elapsedMs: undefined },
			120,
			0,
		),
	)
	assert.ok(line.includes(subject))
	assert.equal(line.slice(-32), ' '.repeat(32))
	assert.doesNotMatch(line, /\d\.\ds/u)
})

void test('elapsed duration and compact max label remain together at the right', () => {
	const line = renderActivityLine(
		{ ...readView, timeoutSeconds: 120 },
		100,
		0,
	)
	const plain = stripVTControlCharacters(line)
	assert.ok(plain.endsWith('1.2s · 120s max'))
	assert.doesNotMatch(plain, /timeout/u)
	assert.equal(plain.indexOf('file.ts'), 17)
	assert.ok(line.includes(uiTheme.fg('dim', '120s max')))
	assert.equal(plain.length, 100)
})

void test('wide failed rows retain duration, timeout and error status together', () => {
	const line = stripVTControlCharacters(
		renderActivityLine(
			{
				...readView,
				phase: 'error',
				summary: 'exit 7',
				timeoutSeconds: 120,
			},
			120,
			0,
		),
	)
	assert.ok(line.endsWith('1.2s · 120s max · error'))
})

for (const phase of ['error', 'cancelled'] as const) {
	void test(`${phase} belongs beside the duration, never between tool and count`, () => {
		const failure: ActivityLine = {
			...readView,
			phase,
			summary: 'ENOENT: file not found',
		}
		const line = stripVTControlCharacters(
			renderActivityLine(failure, 100, 0),
		)
		assert.equal(line.slice(6, 15).trim(), 'read')
		assert.ok(line.endsWith(`1.2s · ${phase}`))
		for (const width of [40, 64]) {
			const narrow = stripVTControlCharacters(
				renderActivityLine(failure, width, 0),
			)
			assert.ok(narrow.endsWith(phase))
			assert.equal(narrow.length, width)
		}
	})
}

void test('normal text retains its ink while live counts and timing remain muted', () => {
	const line = renderActivityLine({ ...readView, phase: 'running' }, 80, 0)
	assert.ok(line.includes(uiTheme.fg('output', 'file.ts')))
	assert.ok(line.includes(uiTheme.fg('dim', '10l')))
	assert.ok(line.includes(uiTheme.fg('dim', '1.2s')))
})
