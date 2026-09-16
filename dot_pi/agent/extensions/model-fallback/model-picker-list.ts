/**
 * model-fallback - the session tab of the picker: the search line and the
 * scrolling model list with its reasoning levels.
 *
 * The price panel that follows the list lives in `model-picker-price.ts`.
 * Rendering is pure: it reads the state and the view and returns lines. Nothing
 * here touches the filesystem, the registry or the session, so a repaint can
 * never change what the picker will do.
 */

import { uiTheme } from '../ui/design-system/theme.ts'
import { highlightRow } from '../ui/frame.ts'
import { terminalLineWidth, truncateTerminalLine } from '../ui/terminal-text.ts'

import { effectiveLevel } from './model-catalog.ts'
import { groupWindow, groupedRows } from './model-picker-groups.ts'
import {
	PICKER_CHROME_ROWS,
	PICKER_COMPACT_CHROME_ROWS,
} from './model-picker-line.ts'
import { priceBlock } from './model-picker-price.ts'
import { scopeGroups } from './model-picker-view.ts'
import {
	MAX_VISIBLE_ROWS,
	aboveHint,
	belowHint,
} from './model-picker-window.ts'

import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import type { CatalogRow } from './model-catalog.ts'
import type { PickerState } from './model-picker-state.ts'
import type { PickerLine, PickerView } from './model-picker-view.ts'

const EFFORT_NAME_WIDTH = 72
const MIN_COLUMN_GAP = 2
const EFFORT_FILLED = '▪'
const EFFORT_EMPTY = '▫'
export const SELECTED_MARKER = '▸'
const SELECTED_LEVEL_NAME = 7

export interface SessionBodyInput {
	view: PickerView
	state: PickerState
	/** The catalogue rows the search left, in display order. */
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

/** Left content and a right-aligned block, never wider than the row. */
function twoColumn(left: string, right: string, width: number): string {
	const rightWidth = right ? terminalLineWidth(right) : 0
	if (!rightWidth) return truncateTerminalLine(left, width, '…')
	const leftWidth = terminalLineWidth(left)
	if (leftWidth + rightWidth + MIN_COLUMN_GAP <= width)
		return left + ' '.repeat(width - leftWidth - rightWidth) + right
	const budget = Math.max(0, width - rightWidth - MIN_COLUMN_GAP)
	const clipped = truncateTerminalLine(left, budget, '…')
	const gap = Math.max(
		MIN_COLUMN_GAP,
		width - terminalLineWidth(clipped) - rightWidth,
	)
	return clipped + ' '.repeat(gap) + right
}

/** Filled squares up to the row's level, then the level's own name. */
function effortSquare(isReached: boolean): string {
	return isReached
		? uiTheme.fg('muted', EFFORT_FILLED)
		: uiTheme.fg('dim', EFFORT_EMPTY)
}

/** A pending level is an unsaved edit, so it wears the accent ink. */
function levelInk(
	level: ModelThinkingLevel | undefined,
	isPending: boolean,
): 'accent' | 'muted' | 'dim' {
	if (isPending) return 'accent'
	return level ? 'muted' : 'dim'
}

/** The squares and level name a row shows, shared with the agent editor. */
export function effortBlock(
	row: CatalogRow,
	level: ModelThinkingLevel | undefined,
	width: number,
	isPending: boolean,
): string {
	const reached = level ? row.levels.indexOf(level) : -1
	const squares = row.levels
		.map((_, index) => effortSquare(index <= reached))
		.join('')
	if (width < EFFORT_NAME_WIDTH) return squares
	return `${squares} ${uiTheme.fg(levelInk(level, isPending), (level ?? 'auto').padStart(SELECTED_LEVEL_NAME))}`
}

function scopeTag(row: CatalogRow): string {
	if (row.isCurrent) return uiTheme.fg('success', '  current')
	if (!row.isInScope) return uiTheme.fg('dim', '  out of scope')
	return ''
}

/** One list row: the model, its scope tag and its reasoning block. */
function modelRowLine(input: {
	row: CatalogRow
	state: PickerState
	view: PickerView
	width: number
	isSelected: boolean
}): string {
	const { row, state, view, width, isSelected } = input
	const pending = state.levels.get(row.reference)
	const level = effectiveLevel(row, pending, view.sessionLevel)
	const marker = isSelected
		? uiTheme.fg('accent', SELECTED_MARKER)
		: uiTheme.fg('dim', ' ')
	const name = uiTheme.fg(row.isInScope ? 'text' : 'muted', row.reference)
	const right = effortBlock(row, level, width, Boolean(pending))
	const line = twoColumn(` ${marker}${name}${scopeTag(row)}`, right, width)
	if (!isSelected) return line
	return highlightRow(line, width)
}

export function renderSessionBody(input: SessionBodyInput): PickerLine[] {
	const { rows, state } = input
	const lines: PickerLine[] = [
		// The input's own line stays verbatim: it carries the cursor marker and
		// the picker already sized it to the viewport.
		{ text: input.searchLine },
	]
	if (!rows.length) {
		lines.push({ text: `  ${uiTheme.fg('dim', 'no model matches')}` })
		return lines
	}
	const window = groupWindow({
		rowCount: rows.length,
		cursor: state.cursor,
		maxRows: input.window.maxRows,
		groups: scopeGroups(rows),
	})
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
					width: input.width,
					isSelected: index === state.cursor,
				}),
				pick: index,
			}),
		}),
	)
	const below = rows.length - window.end
	if (below > 0) lines.push(belowHint(below, input.width))
	return [
		...lines,
		...priceBlock({
			view: input.view,
			width: input.width,
			isCompact: input.window.isCompact,
			selected: rows[state.cursor] ?? rows[0],
		}),
	]
}
