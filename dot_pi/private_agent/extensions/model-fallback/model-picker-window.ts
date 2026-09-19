/**
 * model-fallback - the scrolling chrome the picker's tab bodies share: the rows
 * a body has left once its own headers are paid for, and the ▲/▼ hints that
 * account for the rows a window hides.
 */

import { uiTheme } from '../ui/design-system/theme.ts'

import { INDENT, PICKER_TAB_CHROME_ROWS, line } from './model-picker-line.ts'

import type { PickerLine, RenderInput } from './model-picker-view.ts'

/** The list keeps a compact height, like the picker it is modelled on. */
export const MAX_VISIBLE_ROWS = 10
/** Both scroll hints may appear at once: their rows are reserved up front. */
export const HINT_ROWS = 2

/** Rows a tab body may use once its own chrome and headers are paid for. */
export function bodyRows(input: RenderInput, headerRows: number): number {
	return Math.max(
		1,
		Math.min(
			MAX_VISIBLE_ROWS,
			input.size.height - PICKER_TAB_CHROME_ROWS - headerRows - HINT_ROWS,
		),
	)
}

export function aboveHint(firstVisibleRow: number, width: number): PickerLine {
	return line(
		`${INDENT}${uiTheme.fg('dim', `▲ ${String(firstVisibleRow)} above`)}`,
		width,
	)
}

export function belowHint(hiddenRows: number, width: number): PickerLine {
	return line(
		`${INDENT}${uiTheme.fg('dim', `▼ ${String(hiddenRows)} below`)}`,
		width,
	)
}

/** Both hints, above the list: the shape every tab body draws. */
export function scrollHints(
	input: RenderInput,
	window: { start: number; end: number },
	rowCount: number,
): PickerLine[] {
	const hints: PickerLine[] = []
	if (window.start > 0) hints.push(aboveHint(window.start, input.size.width))
	const below = rowCount - window.end
	if (below > 0) hints.push(belowHint(below, input.size.width))
	return hints
}
