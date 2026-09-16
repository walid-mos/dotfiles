/**
 * model-fallback - the picker's editable state.
 *
 * Every transition is pure and returns new state, so what a keypress does is
 * decided here and nowhere else, and the renderer only reads. Model and effort
 * choices stay *pending* in this state until the picker is confirmed: an escape
 * that closes the picker therefore discards them, which is what cancel has to
 * mean when a keystroke can move the session to another provider.
 *
 * Escape itself is one level at a time (`escapeStep`): a search draft clears,
 * then an open editor closes back to its tab, then a row action the user just
 * committed is released, and only then does the picker close.
 */

import type { ModelThinkingLevel } from '@earendil-works/pi-ai'

export type PickerTab = 'session' | 'scope' | 'fallbacks' | 'agents'

export const PICKER_TABS: readonly PickerTab[] = [
	'session',
	'scope',
	'fallbacks',
	'agents',
]

export interface PickerState {
	tab: PickerTab
	/** Row the cursor sits on in the active tab (or editor). */
	cursor: number
	/** Unsaved effort choices, keyed by model reference. */
	levels: ReadonlyMap<string, ModelThinkingLevel>
	/** The inline agent editor, while one is open. */
	editor: AgentEditor | undefined
	/** A committed row action: the next escape backs out to the list first. */
	shouldEscapeBack: boolean
}

/** The inline agent editor: one agent's model search and its unsaved levels. */
export interface AgentEditor {
	agent: string
	/** Row the editor's cursor sits on in the catalogue search. */
	cursor: number
	/** The agents-tab row to return to when the editor closes. */
	returnCursor: number
	/** Unsaved level choices in the editor, keyed by model reference. */
	levels: ReadonlyMap<string, ModelThinkingLevel>
}

/** What the next escape does, one level at a time. */
export type EscapeStep =
	| 'clear-search'
	| 'back-editor'
	| 'back-action'
	| 'close-picker'

export function initialPickerState(): PickerState {
	return {
		tab: 'session',
		cursor: 0,
		levels: new Map(),
		editor: undefined,
		shouldEscapeBack: false,
	}
}

/** What the picker resolves into when its modal closes. */
export type PickerOutcome =
	| { kind: 'cancel' }
	| {
			kind: 'model'
			reference: string
			level: ModelThinkingLevel | undefined
	  }
	| { kind: 'open-agents' }

/** Tab order is the strip order: both directions wrap. */
export function switchTab(state: PickerState, delta: number): PickerState {
	const index = PICKER_TABS.indexOf(state.tab)
	const next = (index + delta + PICKER_TABS.length) % PICKER_TABS.length
	return {
		...state,
		tab: PICKER_TABS[next] ?? 'session',
		cursor: 0,
		shouldEscapeBack: false,
	}
}

/**
 * What the next escape does: one level back at a time. A search draft is
 * cleared first, then an open editor closes back to its tab, then a committed
 * row action is released, and only a plain tab closes the picker.
 */
export function escapeStep(state: PickerState, query: string): EscapeStep {
	if (query !== '') return 'clear-search'
	if (state.editor) return 'back-editor'
	if (state.shouldEscapeBack) return 'back-action'
	return 'close-picker'
}

/** A committed row action: the next escape backs out to the list first. */
export function commitAction(state: PickerState): PickerState {
	return state.shouldEscapeBack ? state : { ...state, shouldEscapeBack: true }
}

export function openAgentEditor(
	state: PickerState,
	editor: AgentEditor,
): PickerState {
	return { ...state, editor, shouldEscapeBack: false }
}

/** Esc back to the tab the editor was opened from, on the agent's own row. */
export function closeAgentEditor(state: PickerState): PickerState {
	const { editor } = state
	if (!editor) return state
	return {
		...state,
		editor: undefined,
		cursor: editor.returnCursor,
		shouldEscapeBack: false,
	}
}

/** One pending level choice inside the editor. */
export function withEditorLevel(
	state: PickerState,
	reference: string,
	level: ModelThinkingLevel,
): PickerState {
	const { editor } = state
	if (!editor) return state
	const levels = new Map(editor.levels)
	levels.set(reference, level)
	return { ...state, editor: { ...editor, levels } }
}

/** The row the cursor sits on: the editor's own list while it is open. */
function activeCursor(state: PickerState): number {
	const { editor } = state
	return editor ? editor.cursor : state.cursor
}

function withCursor(state: PickerState, cursor: number): PickerState {
	const { editor } = state
	if (!editor) return cursor === state.cursor ? state : { ...state, cursor }
	if (cursor === editor.cursor) return state
	return { ...state, editor: { ...editor, cursor } }
}

/** Any change to the row list re-clamps the cursor instead of losing it. */
export function clampCursor(state: PickerState, rowCount: number): PickerState {
	if (rowCount <= 0) return withCursor(state, 0)
	return withCursor(state, Math.min(activeCursor(state), rowCount - 1))
}

export function moveCursor(
	state: PickerState,
	delta: number,
	rowCount: number,
): PickerState {
	if (rowCount <= 0) return state
	const cursor = Math.min(
		Math.max(activeCursor(state) + delta, 0),
		rowCount - 1,
	)
	return withCursor(state, cursor)
}

/** The cursor on one row: a click selects exactly the row it landed on. */
export function selectRow(state: PickerState, cursor: number): PickerState {
	return withCursor(state, cursor)
}

export function pendingLevel(
	state: PickerState,
	reference: string,
): ModelThinkingLevel | undefined {
	return state.levels.get(reference)
}

export function withPendingLevel(
	state: PickerState,
	reference: string,
	level: ModelThinkingLevel,
): PickerState {
	const levels = new Map(state.levels)
	levels.set(reference, level)
	return { ...state, levels }
}

/** One position up or down inside the chain; ends are hard stops. */
export function reorderEntry(
	chain: readonly string[],
	index: number,
	delta: number,
): string[] {
	const target = index + delta
	if (index < 0 || index >= chain.length) return [...chain]
	if (target < 0 || target >= chain.length) return [...chain]
	const next = [...chain]
	const [moved] = next.splice(index, 1)
	if (!moved) return next
	next.splice(target, 0, moved)
	return next
}

export function removeEntry(chain: readonly string[], index: number): string[] {
	return chain.filter((_, position) => position !== index)
}

/** A model joins the chain once: a duplicate would fail over to itself. */
export function appendEntry(
	chain: readonly string[],
	reference: string,
): string[] {
	if (chain.includes(reference)) return [...chain]
	return [...chain, reference]
}
