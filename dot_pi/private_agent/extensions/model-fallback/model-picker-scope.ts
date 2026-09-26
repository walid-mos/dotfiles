/**
 * model-fallback - the scope tab: the saved `enabledModels` entries as one
 * list, and what each key does to the highlighted one.
 *
 * Every row says where its membership comes from, in the picker's own words:
 * an entry is in the Ctrl+P list, a resolved session model no entry names says
 * `not in Ctrl+P list`, and one a saved pattern covers says `in Ctrl+P list via
 * <pattern>`. Enter toggles the highlighted model - an exact entry leaves the
 * list, a session-only model joins it as its own exact entry, a
 * pattern-covered model is added as one - while a wildcard row is never
 * expanded and never moved by enter; `backspace` removes one whole, which the
 * footer labels. pi resolves the list at session start and `ctx.scopedModels`
 * is a read-only snapshot, so the tab states when an edit applies and never
 * claims the running session changed.
 */

import { uiTheme } from '../ui/design-system/theme.ts'
import { highlightRow } from '../ui/frame.ts'

import { groupWindow, groupedRows } from './model-picker-groups.ts'
import { INDENT, cursorMarker, line, twoColumn } from './model-picker-line.ts'
import { scopeRows } from './model-picker-scope-rows.ts'
import { savedScope } from './model-picker-view.ts'
import { bodyRows, scrollHints } from './model-picker-window.ts'
import { CTRL_P_LIST } from './model-picker-words.ts'

import type { ScopeMembership } from './model-catalog.ts'
import type { ScopeRow } from './model-picker-scope-rows.ts'
import type {
	PickerLine,
	RenderInput,
	ScopeEntry,
} from './model-picker-view.ts'

/** Header lines the scope tab draws above its window: three notes, then air. */
export const SCOPE_HEADER_ROWS = 4

/** What the settings file holds, or why the tab cannot tell. */
function listStatus(input: RenderInput): string {
	const { view } = input
	if (!view.isSettingsReadable)
		return `settings.json could not be read - the ${CTRL_P_LIST} is unknown`
	if (!view.patterns.length) {
		if (!view.scope.length)
			return 'no enabledModels in settings.json - every available model cycles'
		return 'no enabledModels in settings.json - --models supplied this session\u2019s list'
	}
	const count = view.patterns.length
	return `settings.json enabledModels: ${String(count)} ${count === 1 ? 'entry' : 'entries'}`
}

/** When an edit applies: pi reads the list when a session starts. */
function appliesNote(input: RenderInput): string {
	if (!input.view.patterns.length)
		return `pi resolved this session\u2019s ${CTRL_P_LIST} when it started`
	return `${CTRL_P_LIST} edits apply at the next session start; this session keeps the list it started with`
}

/**
 * pi's own selector edits the same list: the tab names it instead of
 * pretending to dispatch a built-in command no extension can reach.
 */
function scopeOwnerNote(input: RenderInput): string {
	return twoColumn(
		`${INDENT}${uiTheme.fg('text', '/scoped-models')} is pi\u2019s own editor for the ${CTRL_P_LIST}`,
		uiTheme.fg('dim', '\u23ce there toggles it'),
		input.size.width,
	)
}

/** What a saved entry resolved to, and that it is in the list. */
function entryMeta(entry: ScopeRow & { kind: 'entry' }): string {
	if (entry.isPattern)
		return uiTheme.fg('dim', `${CTRL_P_LIST} \u00b7 pattern`)
	if (!entry.resolved)
		return uiTheme.fg('dim', `${CTRL_P_LIST} \u00b7 unresolved`)
	const level = uiTheme.fg(
		'dim',
		`${CTRL_P_LIST} \u00b7 ${entry.resolved.level ?? 'inherit'}`,
	)
	if (!entry.resolved.isCurrent) return level
	return `${level}${uiTheme.fg('dim', ' \u00b7 ')}${uiTheme.fg('success', 'current')}`
}

/**
 * A resolved scope model no entry names: a model a saved pattern covers is in
 * the list, and the row names the pattern; without one the running session got
 * it some other way (`--models`), so it is not in the list.
 */
function sessionMeta(entry: ScopeEntry, pattern: string | undefined): string {
	const level = entry.level ?? 'inherit'
	if (!pattern)
		return uiTheme.fg('dim', `not in ${CTRL_P_LIST} \u00b7 ${level}`)
	return uiTheme.fg(
			'dim',
			`in ${CTRL_P_LIST} via ${pattern} \u00b7 ${level}`,
		)
}

function scopeRowText(input: {
	row: ScopeRow
	marker: string
	width: number
	saved: ReadonlyMap<string, ScopeMembership>
	isSelected: boolean
}): string {
	const { row, marker, width, saved, isSelected } = input
	if (row.kind === 'entry')
		return twoColumn(
			`${INDENT}${marker} ${uiTheme.fg('text', isSelected ? uiTheme.bold(row.entry) : row.entry)}`,
			entryMeta(row),
			width,
		)
	return twoColumn(
		`${INDENT}${marker} ${uiTheme.fg('muted', isSelected ? uiTheme.bold(row.entry.reference) : row.entry.reference)}`,
		sessionMeta(row.entry, saved.get(row.entry.reference)?.pattern),
		width,
	)
}

function scopeRowLine(
	row: ScopeRow,
	input: RenderInput,
	index: number,
	saved: ReadonlyMap<string, ScopeMembership>,
): PickerLine {
	const selected = index === input.state.cursor
	const text = scopeRowText({
		row,
		marker: cursorMarker(selected),
		width: input.size.width,
		saved,
		isSelected: selected,
	})
	return {
		text: selected ? highlightRow(text, input.size.width) : text,
		pick: index,
	}
}

export function renderScope(input: RenderInput): PickerLine[] {
	const rows = scopeRows(input.view)
	const saved = savedScope(input.view)
	const window = groupWindow({
		rowCount: rows.length,
		cursor: input.state.cursor,
		maxRows: bodyRows(input, SCOPE_HEADER_ROWS),
		groups: [],
	})
	return [
		line(
			`${INDENT}${uiTheme.fg('dim', listStatus(input))}`,
			input.size.width,
		),
		line(
			`${INDENT}${uiTheme.fg('dim', appliesNote(input))}`,
			input.size.width,
		),
		{ text: scopeOwnerNote(input) },
		{ text: '' },
		...scrollHints(input, window, rows.length),
		...groupedRows({
			rows,
			window,
			width: input.size.width,
			renderRow: (row, index) => scopeRowLine(row, input, index, saved),
		}),
	]
}

/**
 * The scope footer, naming what the highlighted row's keys do. A wildcard row
 * says its removal is explicit, so nothing here can read as a safe toggle; a
 * model a saved pattern already covers is offered an explicit entry.
 */
export function scopeHint(input: RenderInput): string {
	// Every scope edit is a settings.json write: when the file cannot be read,
	// none of them can be saved, so no footer offers one.
	if (!input.view.isSettingsReadable)
		return `\u2191\u2193 select \u00b7 settings.json could not be read - no ${CTRL_P_LIST} edit can be saved \u00b7 {esc} \u00b7 tab target`
	const row = scopeRows(input.view)[input.state.cursor]
	const reorder = '\u2325\u2191 \u2325\u2193 reorder'
	const ends = `${reorder} \u00b7 {esc} \u00b7 tab target`
	if (!row) return `\u2191\u2193 select \u00b7 {esc} \u00b7 tab target`
	if (row.kind === 'session') {
		const pattern = savedScope(input.view).get(row.entry.reference)?.pattern
		const offer = pattern
			? `adds an exact ${CTRL_P_LIST} entry (a pattern already covered it)`
			: `adds it to the ${CTRL_P_LIST}`
		return `\u2191\u2193 select \u00b7 \u23ce ${offer} \u00b7 ${ends}`
	}
	if (row.isPattern)
		return `\u2191\u2193 select \u00b7 \u232b removes this wildcard whole \u00b7 ${ends}`
	return `\u2191\u2193 select \u00b7 \u23ce removes it from the ${CTRL_P_LIST} \u00b7 ${ends}`
}
