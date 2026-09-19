/**
 * model-fallback - the session tab of the picker: the search line, the legend
 * that tells the three targets apart, and the scrolling model list with its
 * reasoning levels.
 *
 * The price panel that follows the list lives in `model-picker-price.ts`.
 * Rendering is pure: it reads the state and the view and returns lines. Nothing
 * here touches the filesystem, the registry or the session, so a repaint can
 * never change what the picker will do.
 */

import { uiTheme } from '../ui/design-system/theme.ts'
import { highlightRow } from '../ui/frame.ts'

import { effectiveLevel } from './model-catalog.ts'
import { effortBlock } from './model-picker-effort.ts'
import { groupWindow, groupedRows } from './model-picker-groups.ts'
import {
	INDENT,
	PICKER_CHROME_ROWS,
	PICKER_COMPACT_CHROME_ROWS,
	SELECTED_MARKER,
	line,
	twoColumn,
} from './model-picker-line.ts'
import { priceBlock } from './model-picker-price.ts'
import { savedScope, scopeGroups } from './model-picker-view.ts'
import {
	MAX_VISIBLE_ROWS,
	aboveHint,
	belowHint,
} from './model-picker-window.ts'
import { CTRL_P_LIST, SESSION_LEGEND } from './model-picker-words.ts'

import type { CatalogRow, ScopeMembership } from './model-catalog.ts'
import type { PickerState } from './model-picker-state.ts'
import type { PickerLine, PickerView } from './model-picker-view.ts'

export interface SessionBodyInput {
	view: PickerView
	state: PickerState
	/** The catalogue rows the search left, in saved scope order. */
	rows: readonly CatalogRow[]
	/** Rows the chrome leaves for the list, and whether it had to be cut. */
	window: ListWindow
	width: number
	/** The search line, already rendered by the picker's input component. */
	searchLine: string
}

/** The rows the list may use, and whether the price block was shed for them. */
export interface ListWindow {
	maxRows: number
	isCompact: boolean
}

const MIN_LIST_ROWS = 3

/** A short terminal drops the gauge block before it starves the list. */
export function sessionWindow(height: number): ListWindow {
	const isCompact = height - PICKER_CHROME_ROWS < MIN_LIST_ROWS
	const chrome = isCompact ? PICKER_COMPACT_CHROME_ROWS : PICKER_CHROME_ROWS
	return {
		isCompact,
		maxRows: Math.max(1, Math.min(MAX_VISIBLE_ROWS, height - chrome)),
	}
}

/**
 * Whether the running session cycles this model. Named with the time it speaks
 * about (`now`): a model the saved list covers but this session never resolved
 * carries both this tag and the list's own, which must not read as a
 * contradiction.
 */
function scopeTag(row: CatalogRow): string {
	if (row.isCurrent) return uiTheme.fg('success', '  current')
	if (!row.isInScope) return uiTheme.fg('dim', '  not cycling now')
	return ''
}

/** The list membership of one row: an exact entry, or a saved pattern. */
function savedTag(membership: ScopeMembership | undefined): string {
	if (membership?.exact) return uiTheme.fg('dim', `  in ${CTRL_P_LIST}`)
	if (membership?.pattern)
		return uiTheme.fg(
			'dim',
			`  in ${CTRL_P_LIST} via ${membership.pattern}`,
		)
	return ''
}

/** One list row: the model, its scope tags and its reasoning block. */
function modelRowLine(input: {
	row: CatalogRow
	state: PickerState
	view: PickerView
	/** The saved `enabledModels` membership of every catalogue reference. */
	saved: ReadonlyMap<string, ScopeMembership>
	width: number
	isSelected: boolean
}): string {
	const { row, state, view, saved, width, isSelected } = input
	const pending = state.levels.get(row.reference)
	const level = effectiveLevel(row, pending, view.sessionLevel)
	const marker = isSelected
		? uiTheme.fg('accent', SELECTED_MARKER)
		: uiTheme.fg('dim', ' ')
	const name = uiTheme.fg(row.isInScope ? 'text' : 'muted', row.reference)
	const right = effortBlock(
		{ row, level, isPending: Boolean(pending) },
		width,
	)
	const tags = `${scopeTag(row)}${savedTag(saved.get(row.reference))}`
	const rendered = twoColumn(` ${marker}${name}${tags}`, right, width)
	if (!isSelected) return rendered
	return highlightRow(rendered, width)
}

/** The lines above the list: the search line, the legend, the empty result. */
function listPrefix(input: SessionBodyInput): PickerLine[] {
	const lines: PickerLine[] = [
		// The input's own line stays verbatim: it carries the cursor marker and
		// the picker already sized it to the viewport.
		{ text: input.searchLine },
	]
	// The legend is the first row a short terminal gives up: the header already
	// names both targets with their values, and the list needs the row more.
	if (!input.window.isCompact)
		lines.push(
			line(`${INDENT}${uiTheme.fg('dim', SESSION_LEGEND)}`, input.width),
		)
	if (!input.rows.length)
		lines.push({ text: `  ${uiTheme.fg('dim', 'no model matches')}` })
	return lines
}

/** The windowed model rows, with the hints that account for the hidden ones. */
function listRows(
	input: SessionBodyInput,
	saved: ReadonlyMap<string, ScopeMembership>,
): PickerLine[] {
	const { rows, state } = input
	const window = groupWindow({
		rowCount: rows.length,
		cursor: state.cursor,
		maxRows: input.window.maxRows,
		groups: scopeGroups(rows, reference =>
			Boolean(saved.get(reference)?.exact),
		),
	})
	const lines: PickerLine[] = []
	if (window.start > 0) lines.push(aboveHint(window.start, input.width))
	lines.push(
		...groupedRows({
			rows,
			window,
			width: input.width,
			renderRow: (row, index) => ({
				text: modelRowLine({
					row,
					state,
					view: input.view,
					saved,
					width: input.width,
					isSelected: index === state.cursor,
				}),
				pick: index,
			}),
		}),
	)
	const below = rows.length - window.end
	if (below > 0) lines.push(belowHint(below, input.width))
	return lines
}

export function renderSessionBody(input: SessionBodyInput): PickerLine[] {
	const lines = listPrefix(input)
	if (!input.rows.length) return lines
	return [
		...lines,
		...listRows(input, savedScope(input.view)),
		...priceBlock({
			view: input.view,
			width: input.width,
			isCompact: input.window.isCompact,
			selected: input.rows[input.state.cursor] ?? input.rows[0],
		}),
	]
}
