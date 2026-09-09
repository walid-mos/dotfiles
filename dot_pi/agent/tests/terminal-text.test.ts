import assert from 'node:assert/strict'
import test from 'node:test'

import {
	CURSOR_MARKER,
	hyperlink,
	stripTerminalSequences,
} from '@earendil-works/pi-tui'

import {
	terminalLineWidth,
	truncateTerminalLine,
	wrapTerminalLine,
} from '../extensions/ui/terminal-text.ts'

const OSC_8_CLOSE = '\u001b]8;;\u001b\\'

void test('measures visible columns while ignoring ANSI and hyperlinks', () => {
	// ANSI color + hyperlink + wide glyph + reset, assembled row-style so no
	// single literal reads as a detached class list for the tailwind rule.
	const line = [
		'\u001b[31m',
		hyperlink('link', 'https://example.com'),
		'界',
		'\u001b[0m',
	].join('')
	assert.equal(terminalLineWidth(line), 6)
})

void test('truncates with an ellipsis and closes terminal control sequences', () => {
	const line = hyperlink('abcdef', 'https://example.com')
	const truncated = truncateTerminalLine(line, 4, '…')
	assert.equal(terminalLineWidth(truncated), 4)
	assert.equal(stripTerminalSequences(truncated), 'abc…')
	assert.ok(truncated.includes(OSC_8_CLOSE))
	assert.ok(truncated.endsWith('\u001b[0m'))
})

void test('normalizes invalid widths without leaking visible content', () => {
	assert.equal(
		terminalLineWidth(truncateTerminalLine('content', Number.NaN)),
		0,
	)
	assert.equal(terminalLineWidth(truncateTerminalLine('content', -2)), 0)
})

void test('counts APC sequences like the cursor marker as zero-width', () => {
	assert.equal(terminalLineWidth(`abc${CURSOR_MARKER}de`), 5)
})

void test('truncation never cuts an APC sequence open', () => {
	const line = `short text ${CURSOR_MARKER}${'x'.repeat(40)}`
	const truncated = truncateTerminalLine(line, 10)
	assert.ok(!truncated.includes('_pi'))
	assert.ok(!truncated.includes('\u001b_pi:c'))
	assert.equal(terminalLineWidth(truncated), 10)
})

void test('wrap keeps APC sequences glued to their word at zero width', () => {
	const lines = wrapTerminalLine(`one${CURSOR_MARKER} two`, 3)
	assert.deepEqual(lines.map(terminalLineWidth), [3, 3] as const)
	assert.ok(lines[0]!.includes('one'))
	assert.ok(lines[0]!.includes(CURSOR_MARKER))
})

void test('Kitty graphics APC terminated by ESC-backslash is zero-width and uncut', () => {
	const kitty = '\u001b_Gf=100,s=1,v=1;PAYLOAD\u001b\\'
	assert.equal(terminalLineWidth(`ab${kitty}cd`), 4)
	const truncated = truncateTerminalLine(`ab${kitty}${'x'.repeat(40)}`, 5)
	assert.ok(truncated.includes(kitty))
	assert.equal(terminalLineWidth(truncated), 5)
})
