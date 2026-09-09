import assert from 'node:assert/strict'
import test from 'node:test'

import {
	backgroundHex,
	blendHex,
	foregroundHex,
	hexToRgb,
} from '../extensions/ui/design-system/terminal-color.ts'
import { uiTheme } from '../extensions/ui/design-system/theme.ts'
import { selectionMarker } from '../extensions/ui/selection-marker.ts'

void test('house semantic roles use the intended Latte colors', () => {
	assert.equal(
		uiTheme.fg('accent', 'x'),
		'\u001b[38;2;136;57;239mx\u001b[39m',
	)
	assert.equal(
		uiTheme.fg('success', 'x'),
		'\u001b[38;2;64;160;43mx\u001b[39m',
	)
})

void test('hex colors are validated before rendering', () => {
	assert.deepEqual(hexToRgb('#209fb5'), [32, 159, 181])
	assert.equal(foregroundHex('#010203', 'x'), '\u001b[38;2;1;2;3mx\u001b[39m')
	assert.throws(() => hexToRgb('209fb5'), /Expected #rrggbb color/u)
	assert.throws(() => hexToRgb('#zz0000'), /Expected #rrggbb color/u)
})

void test('color blending preserves endpoints and rounds midpoint channels', () => {
	assert.equal(blendHex('#000000', '#ffffff', 0.5), '#808080')
	assert.equal(blendHex('#123456', '#abcdef', 0), '#123456')
	assert.equal(blendHex('#123456', '#abcdef', 1), '#abcdef')
})

void test('selection backgrounds survive nested foreground resets and clipping resets', () => {
	assert.equal(
		backgroundHex('#010203', 'a\u001b[0mb\u001b[49mc'),
		'\u001b[48;2;1;2;3ma\u001b[0m\u001b[48;2;1;2;3mb\u001b[48;2;1;2;3mc\u001b[49m',
	)
})

void test('selected markers are bold green while unchecked boxes stay readable', () => {
	assert.equal(
		selectionMarker({ kind: 'multi', isChecked: true }),
		'\u001b[38;2;64;160;43m\u001b[1m▣\u001b[22m\u001b[39m',
	)
	assert.equal(
		selectionMarker({ kind: 'multi', isChecked: false }),
		'\u001b[38;2;108;111;133m□\u001b[39m',
	)
})
