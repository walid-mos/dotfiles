/**
 * model-fallback - the inline agent editor: one agent's pinned model and
 * thinking level, changed without leaving the picker.
 *
 * The rows are the same catalogue search the session tab lists, and the level a
 * row shows comes from the model's own pi-reported levels, so the editor can
 * never offer - or save - a level the model does not accept. `editorEdit` is
 * what enter commits: the settings writer owns the file, this module only
 * decides which two keys change.
 */

import { uiTheme } from '../ui/design-system/theme.ts'
import { highlightRow } from '../ui/frame.ts'

import { stepLevel } from './model-catalog.ts'
import { groupWindow, groupedRows } from './model-picker-groups.ts'
import { INDENT, line, twoColumn } from './model-picker-line.ts'
import { SELECTED_MARKER, effortBlock } from './model-picker-list.ts'
import {
	closeAgentEditor,
	commitAction,
	openAgentEditor,
	withEditorLevel,
} from './model-picker-state.ts'
import { agentPin, searchRows } from './model-picker-view.ts'
import { bodyRows, scrollHints } from './model-picker-window.ts'

import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import type { CatalogRow } from './model-catalog.ts'
import type { AgentOverrideEdit } from './model-picker-settings.ts'
import type { AgentEditor, PickerState } from './model-picker-state.ts'
import type {
	AgentPin,
	PickerLine,
	PickerView,
	RenderInput,
} from './model-picker-view.ts'

/** The editor's own header line and the search line under it. */
const EDITOR_HEADER_ROWS = 2

/** The editor's opening state: the cursor on the model the agent pins. */
export function editorForAgent(
	view: PickerView,
	returnCursor: number,
	pin: AgentPin,
): AgentEditor {
	const cursor = searchRows(view, '').findIndex(
		row => row.reference === pin.model,
	)
	return {
		agent: pin.agent,
		cursor: Math.max(0, cursor),
		returnCursor,
		levels: new Map(),
	}
}

/** Open the editor for one pinned agent, from the tab the user is on. */
export function openEditorState(
	view: PickerView,
	state: PickerState,
	pin: AgentPin,
): PickerState {
	return openAgentEditor(state, editorForAgent(view, state.cursor, pin))
}

/** The level the editor shows for a row: its pending step, else the pin's own. */
export function editorLevel(
	row: CatalogRow,
	editor: AgentEditor,
	pin: AgentPin | undefined,
): ModelThinkingLevel | undefined {
	const pending = editor.levels.get(row.reference)
	if (pending) return pending
	if (!pin || pin.model !== row.reference) return undefined
	return row.levels.find(level => level === pin.thinking)
}

/** One left/right step inside the editor, or nothing at the ends. */
export function editorStep(
	view: PickerView,
	editor: AgentEditor,
	query: string,
	delta: number,
): { reference: string; level: ModelThinkingLevel } | undefined {
	const row = searchRows(view, query)[editor.cursor]
	if (!row) return undefined
	const current = editorLevel(row, editor, agentPin(view, editor.agent))
	const level = stepLevel(row.levels, current, delta)
	if (!level || level === current) return undefined
	return { reference: row.reference, level }
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
 * The edit enter commits, or nothing when the agent already pins exactly what
 * the row shows: re-saving an unchanged pin would touch the file for nothing.
 */
export function editorEdit(
	view: PickerView,
	editor: AgentEditor,
	query: string,
): AgentOverrideEdit | undefined {
	const row = searchRows(view, query)[editor.cursor]
	if (!row) return undefined
	const pin = agentPin(view, editor.agent)
	const thinking = editorLevel(row, editor, pin)
	if (pin?.model === row.reference && pin.thinking === thinking)
		return undefined
	return { agent: editor.agent, model: row.reference, thinking }
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

/** What the agent pins now: the line the editor opens with. */
function agentHeader(agent: string, pin: AgentPin | undefined): string {
	const pinned = pin?.model
		? `${uiTheme.fg('dim', 'pinned')} ${uiTheme.fg('text', pin.model)}${pin.thinking ? uiTheme.fg('dim', ` · thinking ${pin.thinking}`) : ''}`
		: uiTheme.fg('dim', 'inherits the session model')
	return `${INDENT}${uiTheme.fg('muted', 'editing')} ${uiTheme.fg('text', agent)} · ${pinned}`
}

/** One editor row: the model, whether it is the pin, and its level block. */
function editorRowLine(input: {
	row: CatalogRow
	editor: AgentEditor
	pin: AgentPin | undefined
	width: number
	isSelected: boolean
	index: number
}): PickerLine {
	const { row, editor, pin, width, isSelected, index } = input
	const level = editorLevel(row, editor, pin)
	const isPending = editor.levels.has(row.reference)
	const tag =
		row.reference === pin?.model ? uiTheme.fg('success', '  pinned') : ''
	const marker = isSelected
		? uiTheme.fg('accent', SELECTED_MARKER)
		: uiTheme.fg('dim', ' ')
	const name = uiTheme.fg('text', row.reference)
	const text = twoColumn(
		` ${marker}${name}${tag}`,
		effortBlock(row, level, width, isPending),
		width,
	)
	return {
		text: isSelected ? highlightRow(text, width) : text,
		pick: index,
	}
}

export function renderAgentEditor(input: RenderInput): PickerLine[] {
	const { view, size, state } = input
	const { editor } = state
	if (!editor) return []
	const pin = agentPin(view, editor.agent)
	const rows = searchRows(view, input.editorQuery)
	const lines: PickerLine[] = [
		line(agentHeader(editor.agent, pin), size.width),
		// The input's own line stays verbatim, like the session tab's.
		{ text: input.searchLine },
	]
	if (!rows.length) {
		lines.push({ text: `  ${uiTheme.fg('dim', 'no model matches')}` })
		return lines
	}
	const window = groupWindow({
		rowCount: rows.length,
		cursor: editor.cursor,
		maxRows: bodyRows(input, EDITOR_HEADER_ROWS),
		groups: [],
	})
	lines.push(...scrollHints(input, window, rows.length))
	lines.push(
		...groupedRows({
			rows,
			window,
			width: size.width,
			renderRow: (row, index) =>
				editorRowLine({
					row,
					editor,
					pin,
					width: size.width,
					isSelected: index === editor.cursor,
					index,
				}),
		}),
	)
	return lines
}
