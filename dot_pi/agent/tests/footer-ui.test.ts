import assert from 'node:assert/strict'
import test from 'node:test'

import {
	getOsc8LinkAtColumn,
	hyperlink,
	stripTerminalSequences,
	visibleWidth,
} from '@earendil-works/pi-tui'

import { quotaColor } from '../extensions/footer/gauge.ts'
import { prLink } from '../extensions/footer/render-git.ts'
import {
	clampFooterLines,
	justifyLine,
	renderFooterLines,
} from '../extensions/footer/render.ts'
import { bracketed } from '../extensions/footer/text.ts'

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

void test('brackets hug content with the quiet punctuation color', () => {
	assert.equal(stripTerminalSequences(bracketed('abc')), '[abc]')
	assert.equal(visibleWidth(bracketed('abc')), 5)
})

void test('the PR link keeps its number inside the brackets', () => {
	const url = 'https://github.com/acme/app/pull/12'
	const line = prLink({ number: 12, url })
	assert.equal(stripTerminalSequences(line), '[PR #12]')
	assert.equal(getOsc8LinkAtColumn(line, 0), url)
	assert.equal(prLink(null), '')
})

void test('line 2 couples the PR link at the git edge', () => {
	const input = {
		width: 200,
		model: 'test-model',
		thinkingLevel: 'off',
		cwd: '~/development/app',
		branch: 'main',
		usage: undefined,
		tokens: { input: 0, output: 0, cost: 0 },
		statuses: [],
		git: null,
		pr: { number: 12, url: 'https://github.com/acme/app/pull/12' },
		quotas: {},
		provider: undefined,
	}
	const [line1 = '', line2 = ''] = renderFooterLines(input)
	assert.ok(line1.length > 0)
	const plain = stripTerminalSequences(line2)
	assert.ok(
		plain.includes(`main \u2502 no git \u2502 [PR #12]`),
	)
})
