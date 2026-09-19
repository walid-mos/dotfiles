/**
 * model-fallback - the inline agent editor: one agent's pinned model and
 * thinking level, changed without leaving the picker.
 *
 * The rows are the same catalogue search the session tab lists, behind an
 * explicit no-model-change row whenever the agent has no model row to open on:
 * a `thinking` level the agents list's left/right wrote on its own, or a model
 * the catalogue does not list. Without that row the cursor would land on the
 * first match and enter would silently pin it - deleting the stored level on
 * the way. Enter commits what the selected row means: no write at all on the
 * no-model-change row (its footer says so), the row's pending step or the
 * stored level on a model row, and the stored text itself while the agent has
 * no model row - even when that text names no level the squares can draw, so
 * the value a user cannot step is still never lost.
 *
 * The cursor opens on the model the agent already runs when the catalogue can
 * show it - its pin, or the model its own definition names - so enter without a
 * deliberate move never repoints an agent that was already configured.
 * `editorEdit` is what enter commits: the settings writer owns the file, this
 * module only decides which two keys change.
 */

import { clampThinkingLevel } from '@earendil-works/pi-ai'

import { knownLevel, stepLevel } from './model-catalog.ts'
import { agentEntries, editorAnchor } from './model-picker-agents.ts'
import { editorRows, hasAnchorRow } from './model-picker-editor-rows.ts'
import {
	closeAgentEditor,
	commitAction,
	openAgentEditor,
	withEditorLevel,
} from './model-picker-state.ts'

import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import type { CatalogRow } from './model-catalog.ts'
import type { AgentEntry } from './model-picker-agents.ts'
import type { AgentOverrideEdit } from './model-picker-settings.ts'
import type { AgentEditor, PickerState } from './model-picker-state.ts'
import type { PickerView } from './model-picker-view.ts'

/**
 * The stored value the editor shows for an agent: its pin, else its own.
 */
export function storedThinking(
	entry: AgentEntry | undefined,
): string | undefined {
	return entry?.pin?.thinking ?? entry?.thinking
}

/**
 * The editor's opening state: the cursor on the model the agent runs, or on
 * the no-model-change row when the catalogue has no row for it.
 */
export function editorForAgent(
	view: PickerView,
	returnCursor: number,
	entry: AgentEntry,
): AgentEditor {
	const anchor = editorAnchor(entry)
	const cursor = editorRows({
		rows: view.rows,
		anchor,
		query: '',
	}).findIndex(row => row.kind === 'model' && row.row.reference === anchor)
	return {
		agent: entry.name,
		cursor: Math.max(0, cursor),
		returnCursor,
		levels: new Map(),
	}
}

/** Open the editor for one agent, from the tab the user is on. */
export function openEditorState(
	view: PickerView,
	state: PickerState,
	entry: AgentEntry,
): PickerState {
	return openAgentEditor(state, editorForAgent(view, state.cursor, entry))
}

/** The level the editor shows for a row: its pending step, else the agent's. */
export function editorLevel(
	view: PickerView,
	row: CatalogRow,
	editor: AgentEditor,
	entry: AgentEntry | undefined,
): ModelThinkingLevel | undefined {
	const pending = editor.levels.get(row.reference)
	if (pending) return pending
	if (!entry) return undefined
	const pinnedLevel = entry.pin?.thinking
	// The agent's own definition supplies the level: this editor does not own
	// that value, so each row shows what the agent would actually run on it -
	// the definition's level clamped exactly as a launch clamps it - instead of
	// repeating an unclamped value the model rejects.
	if (!pinnedLevel) {
		const definitionLevel = knownLevel(entry.thinking)
		if (!definitionLevel) return undefined
		return clampThinkingLevel(row.model, definitionLevel)
	}
	// A pin with no catalogue row of its own has no model row to carry its
	// level: the stored value applies to whichever model the user picks, so
	// every row shows it, the levels a model rejects included.
	if (
		editorAnchor(entry) !== row.reference &&
		hasAnchorRow(editorAnchor(entry), view.rows)
	)
		return undefined
	// The stored value is shown as it is: a level this model does not accept
	// stays visible (and round-trips), instead of reading as inherited.
	return knownLevel(pinnedLevel)
}

/** One left/right step inside the editor, or nothing at the ends. */
export function editorStep(
	view: PickerView,
	editor: AgentEditor,
	query: string,
	delta: number,
): { reference: string; level: ModelThinkingLevel } | undefined {
	const entry = viewAgentEntry(view, editor.agent)
	const row = editorRows({ rows: view.rows, anchor: anchorOf(entry), query })[
		editor.cursor
	]
	if (row?.kind !== 'model') return undefined
	const { row: catalogRow } = row
	const current = editorLevel(view, catalogRow, editor, entry)
	const level = stepLevel(catalogRow.levels, current, delta)
	if (!level || level === current) return undefined
	return { reference: catalogRow.reference, level }
}

/** One left/right step as state, or nothing at the ends. */
export function editorStepState(
	view: PickerView,
	state: PickerState,
	query: string,
	delta: number,
): PickerState | undefined {
	const { editor } = state
	if (!editor) return undefined
	const step = editorStep(view, editor, query, delta)
	if (!step) return undefined
	return withEditorLevel(state, step.reference, step.level)
}

/**
 * The edit enter commits, or nothing when the row is the no-model-change row
 * or shows exactly what the agent already pins: re-saving an unchanged pin
 * would touch the file for nothing, and a stored thinking value the editor
 * cannot show as a level must survive a save the user did not change.
 */
export function editorEdit(
	view: PickerView,
	editor: AgentEditor,
	query: string,
): AgentOverrideEdit | undefined {
	const entry = viewAgentEntry(view, editor.agent)
	const row = editorRows({ rows: view.rows, anchor: anchorOf(entry), query })[
		editor.cursor
	]
	if (row?.kind !== 'model') return undefined
	const { row: catalogRow } = row
	const thinking = editorLevel(view, catalogRow, editor, entry)
	if (
		entry?.pin?.model === catalogRow.reference &&
		unchangedThinking(entry.pin.thinking, thinking)
	)
		return undefined
	return {
		agent: editor.agent,
		model: catalogRow.reference,
		thinking: thinkingToSave(
			entry,
			editor.levels.has(catalogRow.reference),
			thinking,
		),
	}
}

/**
 * The thinking level one committed row saves: the level the user stepped in
 * this editor, or nothing when they did not step one. Leaving the key alone is
 * what keeps an agent's own definition in charge of its level: copying that
 * value into the pin would freeze it, and a later edit to the definition would
 * then be silently outranked by a value nobody chose.
 */
function thinkingToSave(
	entry: AgentEntry | undefined,
	isStepped: boolean,
	shown: ModelThinkingLevel | undefined,
): string | undefined {
	if (isStepped) return shown
	return entry?.pin?.thinking
}

/**
 * True when the editor's shown level is the pin's own: a stored value whose
 * text names no level pi knows cannot be shown as a level at all, so showing
 * none is still not a change - the stored text stays on disk.
 */
function unchangedThinking(
	stored: string | undefined,
	shown: ModelThinkingLevel | undefined,
): boolean {
	if (stored === shown) return true
	if (shown || !stored) return false
	return !knownLevel(stored)
}

/**
 * What enter in the editor leaves behind: the editor closed (and, when the pin
 * changed, the action marked so escape backs out of it), or nothing when the
 * caller should keep the editor open - an unchanged pin, a failed write, or no
 * editor at all.
 */
export function editorCommitState(
	view: PickerView,
	state: PickerState,
	query: string,
	save: (edit: AgentOverrideEdit) => boolean,
): PickerState | undefined {
	const { editor } = state
	if (!editor) return undefined
	const edit = editorEdit(view, editor, query)
	if (!edit) return closeAgentEditor(state)
	if (!save(edit)) return undefined
	return commitAction(closeAgentEditor(state))
}

/** The entry of one editor's agent, read from the same list the tab built. */
function viewAgentEntry(
	view: PickerView,
	agent: string,
): AgentEntry | undefined {
	return agentEntries(view).find(entry => entry.name === agent)
}

function anchorOf(entry: AgentEntry | undefined): string | undefined {
	if (!entry) return undefined
	return editorAnchor(entry)
}
