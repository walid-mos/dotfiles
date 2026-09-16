/**
 * model-fallback - the picker's chrome, its three non-list tabs, and the
 * assembly of the whole frame.
 *
 * The header states, on every tab, which model the *session* runs and that
 * agent pins are configured elsewhere, so the two targets never look alike. The
 * body is a fixed shape: lines are truncated, never wrapped, so the picker
 * holds its layout from a narrow split pane to a wide terminal.
 */

import { uiTheme } from '../ui/design-system/theme.ts'

import { renderAgentEditor } from './model-picker-editor.ts'
import {
	INDENT,
	cursorMarker,
	line,
	separateLine,
} from './model-picker-line.ts'
import { renderSessionBody, sessionWindow } from './model-picker-list.ts'
import { PICKER_TABS, escapeStep } from './model-picker-state.ts'
import {
	renderAgents,
	renderFallbacks,
	renderScope,
} from './model-picker-tabs.ts'
import { activeQuery, searchRows } from './model-picker-view.ts'

import type {
	EscapeStep,
	PickerState,
	PickerTab,
} from './model-picker-state.ts'
import type {
	PickerLine,
	PickerView,
	RenderInput,
} from './model-picker-view.ts'

const TAB_LABELS: Record<PickerTab, string> = {
	session: 'session',
	scope: 'scope',
	fallbacks: 'fallbacks',
	agents: 'agents',
}

/** What the escape key does next, said in the footer as it is decided. */
const ESCAPE_HINTS: Record<EscapeStep, string> = {
	'clear-search': 'esc clear search',
	'back-editor': 'esc back',
	'back-action': 'esc back',
	'close-picker': 'esc close',
}

/** `{esc}` is spliced from the state, so the footer never lies about escape. */
const HINTS: Record<PickerTab, string> = {
	session:
		'↑↓ select · ←→ reasoning · ⏎ switch session model · {esc} · tab target',
	scope: "{esc} · tab target · pi's /scoped-models owns this list",
	fallbacks:
		'↑↓ select · ⌥↑ ⌥↓ reorder · ⏎ toggle/add · ⌫ remove · {esc} · tab target',
	agents: '↑↓ select · ⏎ or click edits the agent · {esc} · tab target',
}

const EDITOR_HINT = '↑↓ select · ←→ thinking · ⏎ save for this agent · {esc}'

/** The footer line: the tab's keys plus what escape does next. */
function hintLine(input: RenderInput): string {
	const template = input.state.editor ? EDITOR_HINT : HINTS[input.state.tab]
	return template.replace(
		'{esc}',
		ESCAPE_HINTS[escapeStep(input.state, activeQuery(input))],
	)
}

function tabStrip(state: PickerState): string {
	return PICKER_TABS.map(tab => {
		const isActive = tab === state.tab
		const label = TAB_LABELS[tab]
		const rendered = isActive
			? uiTheme.fg('accent', uiTheme.bold(label))
			: uiTheme.fg('muted', label)
		return `${cursorMarker(isActive)} ${rendered}`
	}).join(uiTheme.fg('dim', '  '))
}

/** Session above agents: one is the live model, the other a configured target. */
function headerLines(view: PickerView, width: number): PickerLine[] {
	const session = view.currentReference ?? 'none selected'
	const level = view.sessionLevel ? ` · thinking ${view.sessionLevel}` : ''
	const scopeLabel = view.isScopeUnrestricted
		? 'scope unrestricted'
		: `scope ${view.scope.length} models`
	const pinned = view.agentPins.length
	return [
		line(
			`${uiTheme.fg('muted', 'Session')}  ${uiTheme.fg('text', session)}${uiTheme.fg('dim', level)}   ${uiTheme.fg('dim', scopeLabel)}`,
			width,
		),
		line(
			`${uiTheme.fg('muted', 'Agents')}   ${uiTheme.fg(
				'dim',
				pinned
					? `inherit the session model unless pinned (${pinned} pinned)`
					: 'inherit the session model (none pinned)',
			)}`,
			width,
		),
	]
}

/** One renderer per tab: a new tab adds an entry, not a branch. */
const TAB_BODIES = {
	scope: renderScope,
	fallbacks: renderFallbacks,
	agents: renderAgents,
} as const

function tabBody(input: RenderInput): PickerLine[] {
	const { view, state, size } = input
	if (state.editor) return renderAgentEditor(input)
	if (state.tab === 'session')
		return renderSessionBody({
			view,
			state,
			rows: searchRows(view, input.query),
			window: sessionWindow(size.height),
			width: size.width,
			searchLine: input.searchLine,
		})
	return TAB_BODIES[state.tab](input)
}

export function renderPicker(input: RenderInput): PickerLine[] {
	const { view, state, size } = input
	const body = tabBody(input)
	return [
		line(
			`${uiTheme.fg('accent', uiTheme.bold('Models'))}   ${tabStrip(state)}`,
			size.width,
		),
		...headerLines(view, size.width),
		separateLine(size.width),
		...body,
		separateLine(size.width),
		line(`${INDENT}${uiTheme.fg('dim', hintLine(input))}`, size.width),
	]
}
