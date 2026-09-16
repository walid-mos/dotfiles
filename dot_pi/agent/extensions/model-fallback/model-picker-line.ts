/**
 * model-fallback - the two row shapes every picker tab draws: an inset line and
 * a left/right pair, plus the search line the input components render.
 *
 * Both clip to the terminal columns instead of wrapping, so the picker keeps
 * one shape and one height at any width.
 */

import { uiTheme } from '../ui/design-system/theme.ts'
import { terminalLineWidth, truncateTerminalLine } from '../ui/terminal-text.ts'

import type { Input } from '@earendil-works/pi-tui'
import type { PickerLine } from './model-picker-view.ts'

export const INDENT = '  '
/** Rows the session tab's chrome and price block claim before its list. */
export const PICKER_CHROME_ROWS = 13
/** The same chrome without the gauge block, on a terminal too short for it. */
export const PICKER_COMPACT_CHROME_ROWS = 9
/** Rows the report tabs' chrome claims: header, separators and the hint line. */
export const PICKER_TAB_CHROME_ROWS = 6
const COLUMN_GAP = 1
const SELECTED_MARKER = '▸'
const QUIET_MARKER = ' '

/** An inset line, clipped rather than wrapped. */
export function line(text: string, width: number): PickerLine {
	return { text: truncateTerminalLine(text, width, '…') }
}

/** Left content and a right-aligned block, never wider than the row. */
export function twoColumn(left: string, right: string, width: number): string {
	const rightWidth = terminalLineWidth(right)
	const leftWidth = terminalLineWidth(left)
	if (leftWidth + rightWidth + COLUMN_GAP <= width)
		return left + ' '.repeat(width - leftWidth - rightWidth) + right
	return truncateTerminalLine(
		left,
		Math.max(0, width - rightWidth - COLUMN_GAP),
		'…',
	)
}

export function cursorMarker(isSelected: boolean): string {
	return isSelected
		? uiTheme.fg('accent', SELECTED_MARKER)
		: uiTheme.fg('dim', QUIET_MARKER)
}

export function separateLine(width: number): PickerLine {
	return { text: uiTheme.fg('border', '─'.repeat(Math.max(0, width))) }
}

/**
 * The search row, sized to the viewport: pi's input line, which carries the
 * cursor marker for IME, then the match count.
 */
export function searchLine(
	field: Input,
	width: number,
	matches: number,
): string {
	const suffix = uiTheme.fg(
		'dim',
		`  ${String(matches)} match${matches === 1 ? '' : 'es'}`,
	)
	const inputWidth = Math.max(
		1,
		width - INDENT.length - terminalLineWidth(suffix),
	)
	const inputLine = field.render(inputWidth)[0] ?? ''
	return `${INDENT}${inputLine}${suffix}`
}
