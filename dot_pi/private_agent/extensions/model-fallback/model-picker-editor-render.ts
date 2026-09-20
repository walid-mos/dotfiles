/**
 * model-fallback - how the inline agent editor draws: the header that names
 * what the agent runs now, the explicit no-model-change row, and the catalogue
 * rows with the shared reasoning column.
 *
 * Rendering is pure: it reads the view, the editor state and the search the
 * input holds, and returns lines. Which level a row shows is `editorLevel`'s
 * decision; this module only places it.
 */

import { uiTheme } from '../ui/design-system/theme.ts'
import { highlightRow } from '../ui/frame.ts'

import { agentEntries, editorAnchor } from './model-picker-agents.ts'
import { editorRows } from './model-picker-editor-rows.ts'
import { editorLevel, storedThinking } from './model-picker-editor.ts'
import { effortBlock } from './model-picker-effort.ts'
import { groupWindow, groupedRows } from './model-picker-groups.ts'
import {
	INDENT,
	SELECTED_MARKER,
	line,
	twoColumn,
} from './model-picker-line.ts'
import { bodyRows, scrollHints } from './model-picker-window.ts'

import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import type { CatalogRow } from './model-catalog.ts'
import type { AgentEntry } from './model-picker-agents.ts'
import type { EditorRow } from './model-picker-editor-rows.ts'
import type { AgentEditor } from './model-picker-state.ts'
import type {
	PickerLine,
	PickerView,
	RenderInput,
} from './model-picker-view.ts'

/** The editor's own header line and the search line under it. */
const EDITOR_HEADER_ROWS = 2

/** The editor's keys, and the same footer for the row that saves nothing. */
const EDITOR_HINT = '↑↓ select · ←→ thinking · ⏎ save for this agent · {esc}'
const KEEP_HINT = '↑↓ select · ⏎ keeps the override (saves nothing) · {esc}'

/** The editor footer, said for the row under the cursor. */
export function editorHint(input: RenderInput): string {
	const { editor } = input.state
	if (!editor) return EDITOR_HINT
	const entry = viewEntry(input.view, editor.agent)
	const row = editorRows({
		rows: input.view.rows,
		anchor: entry ? editorAnchor(entry) : undefined,
		query: input.editorQuery,
	})[editor.cursor]
	return row?.kind === 'keep' ? KEEP_HINT : EDITOR_HINT
}

/** The agent's own entry, read from the same list the agents tab built. */
function viewEntry(view: PickerView, agent: string): AgentEntry | undefined {
	return agentEntries(view).find(entry => entry.name === agent)
}

/** The model the agent runs, or that it inherits the session's: header words. */
function pinnedText(
	entry: AgentEntry | undefined,
	rows: readonly CatalogRow[],
): string {
	if (entry?.pin?.model) {
		const isListed = rows.some(row => row.reference === entry.pin?.model)
		if (isListed)
			return `${uiTheme.fg('dim', 'pinned')} ${uiTheme.fg('text', entry.pin.model)}`
		return `${uiTheme.fg('dim', 'pinned')} ${uiTheme.fg('warning', entry.pin.model)} ${uiTheme.fg('dim', '· not in the catalogue')}`
	}
	// An agent this picker has never pinned still has a model of its own when
	// the package reports one: the header names it as such, never as a pin.
	if (entry?.modelOrigin === 'agent' && entry.model)
		return `${uiTheme.fg('dim', 'uses')} ${uiTheme.fg('text', entry.model)}`
	if (entry?.modelOrigin === 'default' && entry.model)
		return `${uiTheme.fg('dim', 'subagents default')} ${uiTheme.fg('text', entry.model)}`
	return uiTheme.fg('dim', 'inherits the session model')
}

/** What the agent runs now: the line the editor opens with. */
function agentHeader(
	agent: string,
	entry: AgentEntry | undefined,
	rows: readonly CatalogRow[],
): string {
	const stored = storedThinking(entry)
	const thinking = stored ? uiTheme.fg('dim', ` · thinking ${stored}`) : ''
	// Where the definition comes from matters when editing it: a builtin agent
	// is the package's, anything else is a file someone can open.
	const source =
		entry?.source && entry.source !== 'builtin'
			? uiTheme.fg('dim', ` (${entry.source})`)
			: ''
	return `${INDENT}${uiTheme.fg('muted', 'editing')} ${uiTheme.fg('text', agent)}${source} · ${pinnedText(entry, rows)}${thinking}`
}

/** True when a shown level is one the model does not accept. */
function isUnsupported(
	row: CatalogRow,
	level: ModelThinkingLevel | undefined,
): boolean {
	if (!level) return false
	return !row.levels.includes(level)
}

/** The no-model-change row: it keeps the override whole, so enter saves nothing. */
function keepRowLine(input: {
	entry: AgentEntry | undefined
	width: number
	isSelected: boolean
	index: number
}): PickerLine {
	const { entry, width, isSelected, index } = input
	const marker = isSelected
		? uiTheme.fg('accent', SELECTED_MARKER)
		: uiTheme.fg('dim', ' ')
	const stored = storedThinking(entry)
	let kept = 'no pin yet'
	if (entry?.pin) kept = stored ? `thinking ${stored}` : 'no change'
	// An agent with no pin yet has no override to keep: the row says what it
	// does instead of naming a stored value that is not there.
	const label = entry?.pin
		? 'keep the stored override'
		: 'leave this agent unchanged'
	const labelInk = uiTheme.fg(
		'text',
		isSelected ? uiTheme.bold(label) : label,
	)
	const text = twoColumn(
		`${INDENT}${marker} ${labelInk}`,
		uiTheme.fg('dim', kept),
		width,
	)
	return { text: isSelected ? highlightRow(text, width) : text, pick: index }
}

/** The tag a row carries when it is the model the agent already runs. */
function rowTag(entry: AgentEntry | undefined, row: CatalogRow): string {
	if (!entry) return ''
	if (entry.pin?.model === row.reference)
		return uiTheme.fg('success', '  pinned')
	if (
		!entry.pin?.model &&
		entry.model === row.reference &&
		(entry.modelOrigin === 'agent' || entry.modelOrigin === 'default')
	)
		return uiTheme.fg('dim', '  current')
	return ''
}

/** One editor row: the model, whether it is the pin, and its level block. */
function editorRowLine(input: {
	row: EditorRow
	view: PickerView
	editor: AgentEditor
	entry: AgentEntry | undefined
	width: number
	isSelected: boolean
	index: number
}): PickerLine {
	const {
		row: editorRow,
		view,
		editor,
		entry,
		width,
		isSelected,
		index,
	} = input
	if (editorRow.kind === 'keep')
		return keepRowLine({ entry, width, isSelected, index })
	const { row } = editorRow
	const level = editorLevel(view, row, editor, entry)
	const isPending = editor.levels.has(row.reference)
	const marker = isSelected
		? uiTheme.fg('accent', SELECTED_MARKER)
		: uiTheme.fg('dim', ' ')
	const name = uiTheme.fg(
		'text',
		isSelected ? uiTheme.bold(row.reference) : row.reference,
	)
	const text = twoColumn(
		`${INDENT}${marker} ${name}${rowTag(entry, row)}`,
		effortBlock(
			{
				row,
				level,
				isPending,
				isUnsupported: isUnsupported(row, level),
			},
			width,
		),
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
	const entry = viewEntry(view, editor.agent)
	const rows = editorRows({
		rows: view.rows,
		anchor: entry ? editorAnchor(entry) : undefined,
		query: input.editorQuery,
	})
	const lines: PickerLine[] = [
		line(agentHeader(editor.agent, entry, view.rows), size.width),
		// The input's own line stays verbatim, like the session tab's.
		{ text: input.searchLine },
	]
	if (!rows.length) {
		lines.push({
			text: `${INDENT}  ${uiTheme.fg('dim', 'no model matches')}`,
		})
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
					view,
					editor,
					entry,
					width: size.width,
					isSelected: index === editor.cursor,
					index,
				}),
		}),
	)
	return lines
}
