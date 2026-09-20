/**
 * model-fallback - the group dividers and windowed row lists of the picker.
 *
 * A mixed list keeps its models above its options and says so with a real dim
 * rule; the session list splits its scoped models from the available rest the
 * same way. A divider is a display line, never a row: the cursor and the `pick`
 * of a row stay row indices, so a key or a click can never land on a rule. The
 * window counts the dividers it draws against its own row budget, so a short
 * terminal drops them before it drops the row under the cursor.
 */

import { uiTheme } from '../ui/design-system/theme.ts'
import { terminalLineWidth } from '../ui/terminal-text.ts'

import { INDENT, line } from './model-picker-line.ts'

import type { PickerLine, RowGroup } from './model-picker-view.ts'

const RULE_GLYPH = '─'
const LABEL_LEAD = '── '
const LABEL_GAP = 1
const WINDOW_HALVES = 2

export interface GroupWindow {
	start: number
	end: number
	/** The groups whose divider falls inside the window, in row order. */
	groups: readonly RowGroup[]
}

/** A dim horizontal rule with its muted label: `  ── scoped ────────────`. */
export function dividerLine(label: string, width: number): PickerLine {
	const fill = Math.max(
		0,
		width -
			INDENT.length -
			LABEL_LEAD.length -
			terminalLineWidth(label) -
			LABEL_GAP,
	)
	return line(
		`${INDENT}${uiTheme.fg('dim', LABEL_LEAD)}${uiTheme.fg('muted', label)}${uiTheme.fg('dim', ` ${RULE_GLYPH.repeat(fill)}`)}`,
		width,
	)
}

/** A cursor-centred window, so a wrapped-around cursor stays visible. */
function windowStart(rowCount: number, cursor: number, size: number): number {
	const half = Math.floor(size / WINDOW_HALVES)
	return Math.min(Math.max(cursor - half, 0), rowCount - size)
}

/**
 * The rows a list shows, with the dividers that fit inside its row budget. A
 * divider is drawn only above its own group's first visible row; when even one
 * row plus its divider does not fit, the divider is dropped, never the cursor.
 */
export function groupWindow(input: {
	rowCount: number
	cursor: number
	maxRows: number
	groups: readonly RowGroup[]
}): GroupWindow {
	const { rowCount, cursor, maxRows, groups } = input
	if (rowCount <= 0) return { start: 0, end: 0, groups: [] }
	for (let size = Math.min(maxRows, rowCount); size >= 1; size -= 1) {
		const start = windowStart(rowCount, cursor, size)
		const end = start + size
		const visible = groups.filter(
			group => group.firstRow >= start && group.firstRow < end,
		)
		if (size + visible.length <= maxRows)
			return { start, end, groups: visible }
	}
	const start = windowStart(rowCount, cursor, 1)
	return { start, end: start + 1, groups: [] }
}

/** The window's rows, each preceded by its group's divider when one is due. */
export function groupedRows<T>(input: {
	rows: readonly T[]
	window: GroupWindow
	width: number
	renderRow: (row: T, index: number) => PickerLine
}): PickerLine[] {
	const { rows, window: visible, width, renderRow } = input
	const lines: PickerLine[] = []
	rows.slice(visible.start, visible.end).forEach((row, offset) => {
		const index = visible.start + offset
		const group = visible.groups.find(
			candidate => candidate.firstRow === index,
		)
		if (group) lines.push(dividerLine(group.label, width))
		lines.push(renderRow(row, index))
	})
	return lines
}
