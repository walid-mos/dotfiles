import assert from 'node:assert/strict'
import test from 'node:test'

import { uiTheme } from '../extensions/ui/design-system/theme.ts'
import { colorizeRailLine } from '../extensions/ui/relay-line.ts'

const { fg } = uiTheme

void test('rail rows paint connectors, state lights and dot leaders', () => {
	assert.equal(
		colorizeRailLine('├─ ● find  src  ······ 8/8'),
		`${fg('muted', '├─')} ${fg('success', '●')} find  src  ${fg('muted', '·').repeat(6)} 8/8`,
	)
	assert.equal(
		colorizeRailLine('├─ ◐ read  b.ts  ····'),
		`${fg('muted', '├─')} ${fg('warning', '◐')} read  b.ts  ${fg('muted', '·').repeat(4)}`,
	)
	assert.equal(
		colorizeRailLine('└─ ✕ grep  -n pat p.ts'),
		`${fg('muted', '└─')} ${fg('danger', '✕')} grep  -n pat p.ts`,
	)
})

void test('header, footer and pending lights use their own roles', () => {
	assert.equal(
		colorizeRailLine('❯ task · 1/3 · find→read→grep'),
		[
			fg('accent', '❯'),
			' task ',
			fg('muted', '·'),
			' 1/3 ',
			fg('muted', '·'),
			' find→read→grep',
		].join(''),
	)
	assert.equal(
		colorizeRailLine('        ▸ details: "rel read"'),
		`        ${fg('accent', '▸')} details: "rel read"`,
	)
	assert.equal(
		colorizeRailLine('└─ ◇ grep  queued'),
		[fg('muted', '└─'), ' ', fg('dim', '◇'), ' grep  queued'].join(''),
	)
})

void test('verdict-only lines color their leading glyph', () => {
	assert.equal(
		colorizeRailLine('✓ 3/3 steps · 0 edits'),
		`${fg('success', '✓')} 3/3 steps ${fg('muted', '·')} 0 edits`,
	)
	assert.equal(
		colorizeRailLine('✕ 1 failed of 3'),
		`${fg('danger', '✕')} 1 failed of 3`,
	)
})

void test('prose and plain lines pass through byte-for-byte', () => {
	const prose = 'State light = 1st glyph of the row = tool state.'
	assert.equal(colorizeRailLine(prose), prose)
	const plain = 'plain sentence, no rail marker at column one'
	assert.equal(colorizeRailLine(plain), plain)
	const midGlyph = 'report: verdict ✕ was wrong (glyph not on col one)'
	assert.equal(colorizeRailLine(midGlyph), midGlyph)
})

void test('drill-down card frames color like connectors', () => {
	const dashRun = '─'.repeat(11)
	const line = `╭ read · ts 0.4s ${dashRun}`
	assert.equal(
		colorizeRailLine(line),
		[
			fg('muted', '╭'),
			' read ',
			fg('muted', '·'),
			' ts 0.4s ',
			fg('muted', dashRun),
		].join(''),
	)
})

void test('card body keeps its dash runs muted inside a frame line', () => {
	const line = '│ feed → next state ok'
	assert.equal(
		colorizeRailLine(line),
		`${fg('muted', '│')} feed → next state ok`,
	)
})
