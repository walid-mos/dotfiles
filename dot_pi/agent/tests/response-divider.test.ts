import assert from 'node:assert/strict'
import test from 'node:test'
import { stripVTControlCharacters } from 'node:util'

import { visibleWidth } from '@earendil-works/pi-tui'

import { ResponseDivider } from '../extensions/ui/response-divider.ts'

void test('intermediate separator is centered, quiet, and fades symmetrically toward both edges', () => {
	const line = new ResponseDivider('intermediate').render(80)[0] ?? ''
	const plain = stripVTControlCharacters(line)
	assert.match(plain, /^\s+─+$/u)
	const leftMargin = plain.indexOf('─')
	const rightMargin = 80 - plain.length
	assert.ok(Math.abs(leftMargin - rightMargin) <= 1)
	const colors = [...line.matchAll(/\u001b\[38;2;(\d+;\d+;\d+)m/gu)].map(
		match => match[1],
	)
	assert.ok(new Set(colors).size > 8, 'fade is graduated, not a flat line')
	assert.deepEqual(colors, colors.toReversed())
	assert.equal(
		colors[0],
		'234;236;241',
		'outer stroke is close to the Latte background',
	)
	assert.doesNotMatch(line, /\u001b\[1m/u)
})

void test('final separator has a centered accent title and wider visual presence than an update', () => {
	const final = new ResponseDivider('final').render(80)[0] ?? ''
	const update = new ResponseDivider('intermediate').render(80)[0] ?? ''
	const plain = stripVTControlCharacters(final)
	assert.match(plain, /✦ Answer/u)
	assert.ok(
		plain.trim().length > stripVTControlCharacters(update).trim().length,
	)
	assert.match(final, /\u001b\[1m/u)
	const titleStart = plain.indexOf('✦')
	const titleEnd = titleStart + '✦ Answer'.length
	assert.ok(Math.abs(titleStart - (80 - titleEnd)) <= 1)
})

void test('intermediate footers are shorter, fainter and symmetrically faded like their headers', () => {
	const header = new ResponseDivider('intermediate').render(80)[0] ?? ''
	const footer =
		new ResponseDivider('intermediate-footer').render(80)[0] ?? ''
	const plain = stripVTControlCharacters(footer)
	assert.ok(
		plain.trim().length < stripVTControlCharacters(header).trim().length,
	)
	assert.ok(Math.abs(plain.indexOf('─') - (80 - plain.length)) <= 1)
	const headerRed = [...header.matchAll(/\u001b\[38;2;(\d+);\d+;\d+m/gu)].map(
		match => Number(match[1]),
	)
	const footerRed = [...footer.matchAll(/\u001b\[38;2;(\d+);\d+;\d+m/gu)].map(
		match => Number(match[1]),
	)
	assert.deepEqual(footerRed, footerRed.toReversed())
	assert.ok(new Set(footerRed).size > 4)
	assert.ok(
		(footerRed[Math.floor(footerRed.length / 2)] ?? 0) >
			(headerRed[Math.floor(headerRed.length / 2)] ?? Infinity),
	)
	assert.doesNotMatch(footer, /Answer|\u001b\[1m/u)
})

void test('dividers stay on one bounded physical line across tiny, odd and wide viewports', () => {
	for (const emphasis of [
		'intermediate',
		'intermediate-footer',
		'final',
	] as const) {
		const divider = new ResponseDivider(emphasis)
		for (const width of [0, 1, 2, 7, 8, 17, 19, 40, 79, 80, 160]) {
			const lines = divider.render(width)
			assert.equal(lines.length, 1)
			assert.ok(visibleWidth(lines[0] ?? '') <= width)
		}
	}
})
