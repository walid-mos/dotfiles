import assert from 'node:assert/strict'
import test from 'node:test'

import {
	getOsc8LinkAtColumn,
	hyperlink,
	stripTerminalSequences,
	visibleWidth,
} from '@earendil-works/pi-tui'

import { quotaColor } from '../extensions/footer/gauge.ts'
import { clampFooterLines, justifyLine } from '../extensions/footer/render.ts'

void test('footer justification uses the compositor grapheme widths', () => {
	assert.equal(
		stripTerminalSequences(justifyLine('界', 'e\u0301', 8)),
		'界     e\u0301',
	)
})

void test('footer clipping closes links before following content', () => {
	const [line = ''] = clampFooterLines(
		[hyperlink('abcdef', 'https://example.com')],
		3,
	)
	assert.equal(stripTerminalSequences(line), 'abc')
	assert.equal(visibleWidth(line), 3)
	assert.equal(getOsc8LinkAtColumn(`${line}z`, 3), undefined)
})

void test('quota color interpolation keeps the existing stop and midpoint colors', () => {
	assert.equal(quotaColor(100, 100), '#40a02b')
	assert.equal(quotaColor(50, 100), '#ef7914')
	assert.equal(quotaColor(0, 100), '#d20f39')
})
