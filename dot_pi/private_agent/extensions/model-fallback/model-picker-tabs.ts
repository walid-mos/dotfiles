/**
 * model-fallback - the fallback chain tab and the agent pins tab.
 *
 * The fallback tab shows the chain in failover order - the order *is* the
 * behaviour - with the cooldown each entry is serving and the toggles that
 * decide what happens on a failure. The agents tab lists each agent with the
 * model it pins or inherits and the reasoning column the other model lists use;
 * alt+up/down reorders the failover chain, left/right edits one agent's own
 * thinking. The scope tab lives in `model-picker-scope.ts`.
 */

import { uiTheme } from '../ui/design-system/theme.ts'
import { highlightRow } from '../ui/frame.ts'

import {
	agentGroups,
	agentLevel,
	agentModelRow,
	agentRows,
} from './model-picker-agents.ts'
import { effortBlock } from './model-picker-effort.ts'
import { fallbackGroups, fallbackRows } from './model-picker-fallbacks.ts'
import { groupWindow, groupedRows } from './model-picker-groups.ts'
import { INDENT, cursorMarker, line, twoColumn } from './model-picker-line.ts'
import { bodyRows, scrollHints } from './model-picker-window.ts'

import type { AgentEntry, AgentRow } from './model-picker-agents.ts'
import type { FallbackRow } from './model-picker-fallbacks.ts'
import type { RenderInput } from './model-picker-view.ts'
import type { PickerLine, PickerView } from './model-picker-view.ts'

const SECONDS_PER_MINUTE = 60
const MS_PER_SECOND = 1_000
/** Header lines a scrolling tab draws above its window. */
const TAB_HEADER_ROWS = 1

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
		const isSelected = index === input.state.cursor
		return {
			text: twoColumn(
				`${INDENT}${marker} ${uiTheme.fg('text', isSelected ? uiTheme.bold(row.label) : row.label)}`,
				stateText,
				input.size.width,
			),
			pick: index,
		}
	}
	if (!(row.kind === 'chain'))
		return {
		text: `${INDENT}${marker} ${uiTheme.fg('dim', '+')} ${uiTheme.fg('muted', row.reference)}`,
		pick: index,
	}
	return {
			text: twoColumn(
				`${INDENT}${marker} ${uiTheme.fg('muted', String(row.index + 1))} ${uiTheme.fg('text', index === input.state.cursor ? uiTheme.bold(row.reference) : row.reference)}`,
				cooldownText(input, row.reference),
				input.size.width,
			),
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

/**
 * The model one agent would run, named with where it comes from. `pin`,
 * `agent` and `default` are the agent's own configured model; anything else is
 * the session's, which the row spells out as inherited. A configured model the
 * catalogue cannot resolve reads as `unknown model` in the level column, so
 * the row never claims a level for a model nobody can run.
 *
 * The origin word is dim and the model muted: the agent's name is the row's
 * anchor, so the two facts after it stay readable without competing with it.
 */
function agentTag(
	view: PickerView,
	entry: AgentEntry,
	isSupported: boolean,
): string {
	const { model } = entry
	if (!model) return uiTheme.fg('dim', '  inherits no session model')
	const ink = isSupported ? 'muted' : 'warning'
	const label = uiTheme.fg(ink, model)
	if (entry.modelOrigin === 'pin')
		return `${uiTheme.fg('dim', '  pinned')} ${label}`
	if (entry.modelOrigin === 'agent')
		return `${uiTheme.fg('dim', '  uses')} ${label}`
	if (!(entry.modelOrigin === 'default'))
		return uiTheme.fg('dim', `  inherits ${model}`)
	return `${uiTheme.fg('dim', '  subagents default')} ${label}${uiTheme.fg('dim', entry.modelScope === 'project' ? ' (project)' : ' (user)')}`
}

/** The agent's name, with the marker a pin that lost its agent earns. */
function agentName(entry: AgentEntry): string {
	if (entry.isKnown) return uiTheme.fg('text', entry.name)
	return `${uiTheme.fg('warning', entry.name)} ${uiTheme.fg('warning', 'no such agent')}`
}

/** One agent: its name and what it runs on the left, its reasoning at right. */
function agentRowLine(
	row: AgentRow,
	input: RenderInput,
	index: number,
): PickerLine {
	const { view, size } = input
	const selected = index === input.state.cursor
	const marker = cursorMarker(selected)
	if (row.kind === 'open') {
		const text = twoColumn(
			`${INDENT}${marker} ${uiTheme.fg(view.hasSubagentsCommand ? 'text' : 'dim', 'open per-agent models')}`,
			uiTheme.fg('dim', '/subagents'),
			size.width,
		)
		return {
			text: selected ? highlightRow(text, size.width) : text,
			pick: index,
		}
	}
	const { entry } = row
	const modelRow = agentModelRow(view, entry.model)
	const name = agentName(entry)
	const text = twoColumn(
		`${INDENT}${marker} ${selected ? uiTheme.bold(name) : name}${agentTag(view, entry, Boolean(modelRow))}`,
		effortBlock(
			{ row: modelRow, level: agentLevel(entry, modelRow) },
			size.width,
		),
		size.width,
	)
	return {
		text: selected ? highlightRow(text, size.width) : text,
		pick: index,
	}
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
	return [
		...scrollHints(input, window, rows.length),
		...groupedRows({
			rows,
			window,
			width: size.width,
			renderRow: (row, index) => agentRowLine(row, input, index),
		}),
	]
}
