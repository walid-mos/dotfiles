/**
 * model-fallback - the picker's chrome, its three non-list tabs, and the
 * assembly of the whole frame.
 *
 * The header names the three targets on every tab - the model this session
 * runs, the startup default new sessions begin on and the list Ctrl+P cycles -
 * and says that agent pins are configured elsewhere, so no two of them look
 * alike. The body is a fixed shape: lines are truncated, never wrapped, so the
 * picker holds its layout from a narrow split pane to a wide terminal.
 */

import { uiTheme } from '../ui/design-system/theme.ts'

import { editorHint, renderAgentEditor } from './model-picker-editor-render.ts'
import { INDENT, line, separateLine, twoColumn } from './model-picker-line.ts'
import { renderSessionBody, sessionWindow } from './model-picker-list.ts'
import { renderScope, scopeHint } from './model-picker-scope.ts'
import { PICKER_TABS, escapeStep } from './model-picker-state.ts'
import { renderAgents, renderFallbacks } from './model-picker-tabs.ts'
import { activeQuery, savedScope, sessionRows } from './model-picker-view.ts'
import { CTRL_P_LIST, CTRL_P_TAB } from './model-picker-words.ts'

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
	scope: CTRL_P_TAB,
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
const HINTS: Record<Exclude<PickerTab, 'scope' | 'session'>, string> = {
	fallbacks:
		'↑↓ select · ⌥↑ ⌥↓ reorder · ⏎ toggle/add · ⌫ remove · {esc} · tab target',
	agents: '↑↓ select · ←→ reasoning · ⏎ or click edits the model · {esc} · tab target',
}

/**
 * The session footer: enter names what it will do to the row under the cursor -
 * a model already in the Ctrl+P list is one this session can run now, one that
 * is not joins the list first - and ctrl+x takes an exact entry back out, which
 * is all that fits at 100 columns. The row itself carries the membership tag,
 * so the keys are named here and the scope tab keeps the per-row wording; when
 * the file cannot be read, no membership is known and no edit can be saved, so
 * the footer says that instead of offering one that cannot happen.
 */
function sessionHint(input: RenderInput): string {
	const row = sessionRows(input.view, input.query)[input.state.cursor]
	if (!row) return '↑↓ · {esc} · tab target'
	if (!input.view.isSettingsReadable)
		return '↑↓ · ←→ reasoning · ⏎ save or switch · ctrl+s startup default · settings.json unreadable · {esc}'
	const membership = savedScope(input.view).get(row.reference)
	if (!membership?.exact) {
		// A pattern stands for every model it matches: removing it stays the
		// scope tab's own explicit action, so ctrl+x is not offered here.
		const via = membership?.pattern
		if (via)
			return `↑↓ · ←→ reasoning · ⏎ switch model · in ${CTRL_P_LIST} via ${via} · {esc}`
		return `↑↓ · ←→ reasoning · ⏎ add to ${CTRL_P_LIST} · ctrl+s startup default · {esc}`
	}
	return `↑↓ · ←→ reasoning · ⏎ switch model · ctrl+x unsave · ctrl+s startup default · {esc}`
}

/** The tab's own hint: these two name the action their highlighted row gets. */
function tabHint(input: RenderInput): string {
	const { tab } = input.state
	if (tab === 'scope') return scopeHint(input)
	if (!(tab === 'session')) return HINTS[tab]
	return sessionHint(input)
}

/** The footer line: the tab's keys plus what escape does next. */
function hintLine(input: RenderInput): string {
	const template = input.state.editor ? editorHint(input) : tabHint(input)
	return template.replace(
		'{esc}',
		ESCAPE_HINTS[escapeStep(input.state, activeQuery(input))],
	)
}

function tabStrip(state: PickerState): string {
	// No cursor marker in the strip: the active tab is the bold accent one, so
	// every gap stays equal and the strip never shifts when the selection moves.
	return PICKER_TABS.map(tab => {
		const isActive = tab === state.tab
		const label = TAB_LABELS[tab]
		return isActive
			? uiTheme.fg('accent', uiTheme.bold(label))
			: uiTheme.fg('muted', label)
	}).join(uiTheme.fg('dim', ' · '))
}

/**
 * What the header says about the agents: the roster's own count when the
 * package answered, and the pins-only sentence when it did not (the pins are
 * then all this extension can see, so it says exactly that).
 */
function agentsNote(view: PickerView): string {
	if (!view.areAgentPinsKnown)
		return 'agent pins unknown - subagents.agentOverrides could not be read'
	const pinned = view.agentPins.length
	if (view.roster) {
		const known = view.roster.length
		const orphans =
			pinned -
			view.agentPins.filter(pin =>
				view.roster?.some(agent => agent.name === pin.agent),
			).length
		const pinNote = pinned ? ` · ${pinned} pinned` : ' · none pinned'
		const orphanNote = orphans ? ` · ${orphans} without a definition` : ''
		return `${known} ${known === 1 ? 'agent' : 'agents'} from the subagents package${pinNote}${orphanNote}`
	}
	if (!pinned)
		return 'inherit the session model and thinking (none pinned)'
	return `inherit the session model and thinking unless pinned (${pinned} pinned)`
}

/** The startup default new sessions begin on, as the settings file states it. */
function startupValue(view: PickerView): string {
	if (!view.isSettingsReadable)
		return uiTheme.fg('warning', 'settings.json could not be read')
	if (!view.startupDefault)
		return uiTheme.fg('dim', 'none set - ctrl+s sets it')
	return `${uiTheme.fg('muted', view.startupDefault)}${uiTheme.fg('dim', ' (ctrl+s)')}`
}

/** How many models the ctrl+p shortcut cycles, or why that count is unknown. */
function cycleValue(view: PickerView): string {
	if (!view.isSettingsReadable) return `${CTRL_P_LIST}: unknown`
	if (view.isScopeUnrestricted) return `${CTRL_P_LIST}: every model`
	const count = view.scope.length
	return `${CTRL_P_LIST}: ${String(count)} ${count === 1 ? 'model' : 'models'}`
}

/**
 * Three labelled facts, one per target: the model this session runs, the model
 * new sessions start on with the list ctrl+p cycles beside it, then the agents.
 * The two that are easiest to confuse never share a line without their label.
 */
function headerLines(view: PickerView, width: number): PickerLine[] {
	const session = view.currentReference ?? 'none selected'
	const level = view.sessionLevel ? ` · thinking ${view.sessionLevel}` : ''
	return [
		// The session model is the one fact that acts now: the only bold value
		// in the block, so the three targets rank at a glance.
		line(
			`${uiTheme.fg('dim', 'Session')}  ${uiTheme.fg('text', uiTheme.bold(session))}${uiTheme.fg('dim', level)}`,
			width,
		),
		{
			text: twoColumn(
				`${uiTheme.fg('dim', 'Startup')}  ${startupValue(view)}`,
				uiTheme.fg('dim', cycleValue(view)),
				width,
			),
		},
		line(
			`${uiTheme.fg('dim', 'Agents')}   ${uiTheme.fg('dim', agentsNote(view))}`,
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
	if (!(state.tab === 'session'))
		return TAB_BODIES[state.tab](input)
	return renderSessionBody({
			view,
			state,
			rows: sessionRows(view, input.query),
			window: sessionWindow(size.height),
			width: size.width,
			searchLine: input.searchLine,
		})
}

export function renderPicker(input: RenderInput): PickerLine[] {
	const { view, state, size } = input
	const body = tabBody(input)
	// The session tab ends on the price block, which closes the body flush
	// against the footer's separator: no gap there for that tab alone.
	const footerGap: PickerLine[] =
		state.tab === 'session' ? [] : [{ text: '' }]
	return [
		line(
			`${uiTheme.fg('accent', uiTheme.bold('Models'))}   ${tabStrip(state)}`,
			size.width,
		),
		...headerLines(view, size.width),
		{ text: '' },
		separateLine(size.width),
		...body,
		...footerGap,
		separateLine(size.width),
		line(`${INDENT}${uiTheme.fg('dim', hintLine(input))}`, size.width),
	]
}
