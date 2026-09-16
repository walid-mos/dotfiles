/**
 * model-fallback - the three non-list tabs: the fallback chain, the session
 * scope, and the agent pins.
 *
 * The fallback tab shows the chain in failover order - the order *is* the
 * behaviour - with the cooldown each entry is serving and the toggles that
 * decide what happens on a failure. The scope and agent tabs report what other
 * owners configured and open those owners' own surfaces; both are scrolling
 * lists whose first row is that action, so the row a user came for stays on
 * screen on a short terminal.
 */

import { uiTheme } from '../ui/design-system/theme.ts'
import { GLYPH } from '../ui/selection-marker.ts'

import { groupWindow, groupedRows } from './model-picker-groups.ts'
import { INDENT, cursorMarker, line, twoColumn } from './model-picker-line.ts'
import {
	agentGroups,
	agentRows,
	fallbackGroups,
	fallbackRows,
	scopeRows,
} from './model-picker-view.ts'
import { bodyRows, scrollHints } from './model-picker-window.ts'

import type { FallbackRow, RenderInput, ScopeRow } from './model-picker-view.ts'
import type { PickerLine } from './model-picker-view.ts'

const SECONDS_PER_MINUTE = 60
const MS_PER_SECOND = 1_000
/** Header lines a scrolling tab draws above its window. */
const TAB_HEADER_ROWS = 1
/** The scope tab adds two status lines and the line naming pi's own selector. */
const SCOPE_HEADER_ROWS = 3

function cooldownText(input: RenderInput, reference: string): string {
	const until = input.view.cooldowns.get(reference) ?? 0
	const seconds = Math.ceil((until - input.view.now) / MS_PER_SECOND)
	if (seconds <= 0) return ''
	if (seconds < SECONDS_PER_MINUTE)
		return uiTheme.fg('warning', `cooling ${seconds}s`)
	return uiTheme.fg(
		'warning',
		`cooling ${Math.ceil(seconds / SECONDS_PER_MINUTE)}m`,
	)
}

function fallbackRowLine(
	row: FallbackRow,
	input: RenderInput,
	index: number,
): PickerLine {
	const marker = cursorMarker(index === input.state.cursor)
	if (row.kind === 'toggle') {
		const stateText = row.isOn
			? uiTheme.fg('success', 'ON')
			: uiTheme.fg('dim', 'OFF')
		return {
			text: twoColumn(
				`${INDENT}${marker} ${uiTheme.fg('text', row.label)}`,
				stateText,
				input.size.width,
			),
			pick: index,
		}
	}
	if (row.kind === 'chain')
		return {
			text: twoColumn(
				`${INDENT}${marker} ${uiTheme.fg('muted', String(row.index + 1))} ${uiTheme.fg('text', row.reference)}`,
				cooldownText(input, row.reference),
				input.size.width,
			),
			pick: index,
		}
	return {
		text: `${INDENT}${marker} ${uiTheme.fg('dim', '+')} ${uiTheme.fg('muted', row.reference)}`,
		pick: index,
	}
}

export function renderFallbacks(input: RenderInput): PickerLine[] {
	const rows = fallbackRows(input.view)
	const window = groupWindow({
		rowCount: rows.length,
		cursor: input.state.cursor,
		maxRows: bodyRows(input, TAB_HEADER_ROWS),
		groups: fallbackGroups(rows),
	})
	const note = input.view.config.chain.length
		? 'toggles apply immediately · chain edits save immediately'
		: 'chain empty - enter a model below to add it'
	return [
		line(`${INDENT}${uiTheme.fg('dim', note)}`, input.size.width),
		...scrollHints(input, window, rows.length),
		...groupedRows({
			rows,
			window,
			width: input.size.width,
			renderRow: (row, index) => fallbackRowLine(row, input, index),
		}),
	]
}

/** What the settings file knows: an unreadable file is unknown, not empty. */
function patternStatus(input: RenderInput): string {
	const { view } = input
	if (!view.isSettingsReadable)
		return 'settings.json could not be read - saved patterns unknown'
	if (!view.patterns.length) return 'no saved scope patterns in settings.json'
	return `saved scope patterns in settings.json: ${String(view.patterns.length)}`
}

/** What this picker read when it opened, which `--models` also shapes. */
function resolvedStatus(input: RenderInput): string {
	const { view } = input
	if (!view.scope.length)
		return 'resolved when the picker opened: unrestricted (every available model is usable)'
	return `resolved when the picker opened: ${String(view.scope.length)} models`
}

/**
 * The one thing this tab cannot do for the user. `/scoped-models` is a built-in
 * interactive command: pi dispatches it only from its own editor, `getCommands`
 * does not list it, and a prefilled editor does not execute it either - typing
 * it is the supported route, so the tab says so instead of faking an action.
 */
function scopeOwnerNote(input: RenderInput): string {
	return twoColumn(
		`${INDENT}pi's own selector owns this list: type ${uiTheme.fg('text', '/scoped-models')}`,
		uiTheme.fg('dim', 'ctrl+s there saves it'),
		input.size.width,
	)
}

function scopeRowLine(
	row: ScopeRow,
	input: RenderInput,
	index: number,
): PickerLine {
	const marker = cursorMarker(index === input.state.cursor)
	if (row.kind === 'pattern')
		return {
			text: twoColumn(
				`${INDENT}${marker} ${uiTheme.fg('muted', row.pattern)}`,
				uiTheme.fg('dim', 'pattern'),
				input.size.width,
			),
			pick: index,
		}
	const { entry } = row
	return {
		text: twoColumn(
			`${INDENT}${marker} ${entry.isCurrent ? uiTheme.fg('success', GLYPH.radioOn) : uiTheme.fg('dim', GLYPH.radioOff)} ${uiTheme.fg('text', entry.reference)}`,
			uiTheme.fg('dim', entry.level ?? 'session'),
			input.size.width,
		),
		pick: index,
	}
}

export function renderScope(input: RenderInput): PickerLine[] {
	const rows = scopeRows(input.view)
	const window = groupWindow({
		rowCount: rows.length,
		cursor: input.state.cursor,
		maxRows: bodyRows(input, SCOPE_HEADER_ROWS),
		groups: [],
	})
	return [
		line(
			`${INDENT}${uiTheme.fg('dim', patternStatus(input))}`,
			input.size.width,
		),
		line(
			`${INDENT}${uiTheme.fg('dim', resolvedStatus(input))}`,
			input.size.width,
		),
		{ text: scopeOwnerNote(input) },
		...scrollHints(input, window, rows.length),
		...groupedRows({
			rows,
			window,
			width: input.size.width,
			renderRow: (row, index) => scopeRowLine(row, input, index),
		}),
	]
}

export function renderAgents(input: RenderInput): PickerLine[] {
	const { view, size } = input
	const rows = agentRows(view)
	const window = groupWindow({
		rowCount: rows.length,
		cursor: input.state.cursor,
		maxRows: bodyRows(input, TAB_HEADER_ROWS),
		groups: agentGroups(rows),
	})
	const body = groupedRows({
		rows,
		window,
		width: size.width,
		renderRow: (row, index) => {
			const marker = cursorMarker(index === input.state.cursor)
			if (row.kind === 'open')
				return {
					text: twoColumn(
						`${INDENT}${marker} ${uiTheme.fg(view.hasSubagentsCommand ? 'text' : 'dim', 'open per-agent models')}`,
						uiTheme.fg('dim', '/subagents'),
						size.width,
					),
					pick: index,
				}
			const detail = `${row.pin.model ?? 'session default'}${row.pin.thinking ? ` · ${row.pin.thinking}` : ''}`
			return {
				text: twoColumn(
					`${INDENT}${marker} ${uiTheme.fg('muted', row.pin.agent)}`,
					uiTheme.fg('dim', detail),
					size.width,
				),
				pick: index,
			}
		},
	})
	return [...scrollHints(input, window, rows.length), ...body]
}
