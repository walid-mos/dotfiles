/** Frame ink is structural only: caller content keeps its own typography. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { stripVTControlCharacters } from 'node:util'

import { uiTheme } from '../extensions/ui/design-system/theme.ts'
import { framedBlock } from '../extensions/ui/frame.ts'

for (const tone of ['border', 'rail'] as const) {
	void test(`${tone} frame ink leaves title and body colors intact`, () => {
		const title = uiTheme.fg('accent', 'Prompt')
		const body = uiTheme.fg('text', 'hello')
		const lines = framedBlock({
			width: 16,
			title,
			lines: [body],
			footer: '',
			...(tone === 'rail' && {
				border: (stroke: string) => uiTheme.fg('rail', stroke),
			}),
		})
		assert.deepEqual(lines, [
			`${uiTheme.fg(tone, '╭─ ')}${title} ${uiTheme.fg(tone, '─────╮')}`,
			`${uiTheme.fg(tone, '│')} ${body}        ${uiTheme.fg(tone, '│')}`,
			uiTheme.fg(tone, '╰──────────────╯'),
		])
	})
}

void test('square frames enclose content on all four sides without changing rounded defaults', () => {
	const lines = framedBlock({
		width: 10,
		title: '',
		lines: ['code'],
		footer: '',
		corners: 'square',
	})
	assert.deepEqual(lines.map(stripVTControlCharacters), [
		'┌────────┐',
		'│ code   │',
		'└────────┘',
	])
	const rounded = framedBlock({ width: 10, title: '', lines: [], footer: '' })
	assert.deepEqual(rounded.map(stripVTControlCharacters), [
		'╭────────╮',
		'╰────────╯',
	])
})
