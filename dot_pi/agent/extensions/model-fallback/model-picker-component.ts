/**
 * model-fallback - the picker's keyboard and mouse contract over pi-tui.
 *
 * The component owns no decisions: every key becomes a pure state transition
 * (`model-picker-state.ts`), a row action (`model-picker-commands.ts`), an
 * inline agent edit (`model-picker-editor.ts`), or one of the outcomes above.
 * Escape goes back one level at a time - search, editor, committed action,
 * tab - so a model or reasoning choice stays *pending* until enter and the
 * escape that finally closes the picker changes nothing.
 *
 * The search fields are pi's own `Input` (paste, Unicode, editing keys, cursor
 * marker for IME) rather than hand-rolled buffers: one for the session list and
 * one for the agent editor, which must not inherit the other's filter.
 */

import { Input, Key, matchesKey } from '@earendil-works/pi-tui'

import {
	activateRow,
	removeChainRow,
	reorderChainRow,
	stepRowLevel,
} from './model-picker-commands.ts'
import {
	editorCommitState,
	editorStepState,
	openEditorState,
} from './model-picker-editor.ts'
import { searchLine } from './model-picker-line.ts'
import { renderPicker } from './model-picker-render.ts'
import {
	clampCursor,
	closeAgentEditor,
	escapeStep,
	initialPickerState,
	moveCursor,
	selectRow,
	switchTab,
} from './model-picker-state.ts'
import {
	activeQuery,
	activeRowCount,
	agentRows,
	searchRows,
} from './model-picker-view.ts'

import type { Component, Focusable } from '@earendil-works/pi-tui'
import type { TuiMouseEvent, TuiMouseEventResult } from '@earendil-works/pi-tui'
import type { ModelFallbackConfig } from './config.ts'
import type { PickerCommand } from './model-picker-commands.ts'
import type { AgentOverrideEdit } from './model-picker-settings.ts'
import type { PickerOutcome, PickerState } from './model-picker-state.ts'
import type {
	AgentPin,
	PickerLine,
	PickerView,
	RowCountInput,
} from './model-picker-view.ts'

export interface PickerComponentDeps {
	/** Read fresh on every render: config edits arrive while the picker is open. */
	view: () => PickerView
	/** The terminal's rows, read per render. */
	height: () => number
	onRender: () => void
	/** Persisted immediately and kept: the picker stays open. */
	onConfigChange: (config: ModelFallbackConfig) => void
	/** Persisted for one agent; false when the settings write failed. */
	onAgentOverrideChange: (edit: AgentOverrideEdit) => boolean
	onDone: (outcome: PickerOutcome) => void
}

const WHEEL_STEP_TO_ROWS = 1

export class ModelPickerComponent implements Component, Focusable {
	/** Set by pi-tui: the search fields position their own cursor markers. */
	focused = false

	private readonly deps: PickerComponentDeps
	private readonly search = new Input({
		prompt: '/ ',
		placeholder: 'Type to search',
	})
	private readonly agentSearch = new Input({
		prompt: '/ ',
		placeholder: 'Type to search',
	})
	private state: PickerState = initialPickerState()
	private cache:
		| { width: number; height: number; lines: PickerLine[] }
		| undefined

	constructor(deps: PickerComponentDeps) {
		this.deps = deps
	}

	render(width: number): string[] {
		const height = this.deps.height()
		if (this.cache?.width === width && this.cache.height === height)
			return this.cache.lines.map(rendered => rendered.text)
		this.search.focused = this.focused
		this.agentSearch.focused = this.focused
		const view = this.deps.view()
		const query = this.search.getValue()
		const editorQuery = this.agentSearch.getValue()
		const field = this.state.editor ? this.agentSearch : this.search
		const active = this.state.editor ? editorQuery : query
		const lines = renderPicker({
			view,
			state: this.state,
			size: { width, height },
			query,
			editorQuery,
			searchLine: searchLine(
				field,
				width,
				searchRows(view, active).length,
			),
		})
		this.cache = { width, height, lines }
		return lines.map(rendered => rendered.text)
	}

	invalidate(): void {
		this.cache = undefined
	}

	handleInput(keyData: string): void {
		this.search.focused = this.focused
		this.agentSearch.focused = this.focused
		if (matchesKey(keyData, Key.escape)) return this.escape()
		if (this.routeNavigation(keyData)) return
		this.routeEditing(keyData)
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type === 'wheel' && event.wheelDelta)
			return this.scrollBy(event.wheelDelta)
		if (event.type !== 'click' || event.button !== 'left') return undefined
		const pick = this.cache?.lines[event.y]?.pick
		if (typeof pick !== 'number') return undefined
		const rows = activeRowCount(this.rowCountInput())
		if (pick >= rows) return undefined
		this.update(clampCursor(selectRow(this.state, pick), rows))
		this.activateAgentRow(pick)
		return { handled: true }
	}

	/** On the agents tab a click also opens what the row is for. */
	private activateAgentRow(pick: number): void {
		if (this.state.editor || this.state.tab !== 'agents') return
		const row = agentRows(this.deps.view())[pick]
		if (row?.kind === 'open') this.activate()
		if (row?.kind === 'pin') this.openEditor(row.pin)
	}

	/** Cursor, chain, tab and level keys; true when the key was consumed. */
	private routeNavigation(keyData: string): boolean {
		const isEditorless = !this.state.editor
		if (isEditorless && matchesKey(keyData, Key.tab))
			this.update(switchTab(this.state, 1))
		else if (isEditorless && matchesKey(keyData, Key.shift('tab')))
			this.update(switchTab(this.state, -1))
		else if (matchesKey(keyData, Key.up)) this.move(-1)
		else if (matchesKey(keyData, Key.down)) this.move(1)
		else if (matchesKey(keyData, Key.left)) this.stepEffort(-1)
		else if (matchesKey(keyData, Key.right)) this.stepEffort(1)
		else if (matchesKey(keyData, Key.enter)) this.activate()
		else if (matchesKey(keyData, Key.alt('up')))
			this.run(reorderChainRow({ ...this.rowCountInput(), delta: -1 }))
		else if (matchesKey(keyData, Key.alt('down')))
			this.run(reorderChainRow({ ...this.rowCountInput(), delta: 1 }))
		else return false
		return true
	}

	/** Text keys: chain removal, the editor filter, or the session filter. */
	private routeEditing(keyData: string): void {
		const { editor, tab } = this.state
		if (
			matchesKey(keyData, Key.backspace) &&
			!editor &&
			tab === 'fallbacks'
		)
			return this.run(removeChainRow(this.rowCountInput()))
		if (editor) {
			this.agentSearch.handleInput(keyData)
			this.move(0)
			return
		}
		if (tab !== 'session') return
		this.search.handleInput(keyData)
		// The filtered list may have shrunk under the cursor.
		this.move(0)
	}

	/** What a key acts on: the active tab's rows, read on every keystroke. */
	private rowCountInput(): RowCountInput {
		return {
			view: this.deps.view(),
			state: this.state,
			query: this.search.getValue(),
			editorQuery: this.agentSearch.getValue(),
		}
	}

	private scrollBy(delta: number): TuiMouseEventResult {
		this.move(delta > 0 ? WHEEL_STEP_TO_ROWS : -WHEEL_STEP_TO_ROWS)
		return { handled: true }
	}

	private update(state: PickerState): void {
		this.state = state
		this.cache = undefined
		this.deps.onRender()
	}

	private move(delta: number): void {
		const rows = activeRowCount(this.rowCountInput())
		this.update(clampCursor(moveCursor(this.state, delta, rows), rows))
	}

	/** Escape: one level back, and only a plain tab closes the picker. */
	private escape(): void {
		const step = escapeStep(this.state, activeQuery(this.rowCountInput()))
		if (step === 'clear-search') {
			if (this.state.editor) this.agentSearch.setValue('')
			else this.search.setValue('')
			return this.update(this.state)
		}
		if (step === 'back-editor')
			return this.update(closeAgentEditor(this.state))
		if (step === 'back-action')
			return this.update({ ...this.state, shouldEscapeBack: false })
		return this.finish({ kind: 'cancel' })
	}

	/** Left/right change the *pending* level of the row under the cursor. */
	private stepEffort(delta: number): void {
		if (this.state.editor) {
			const next = editorStepState(
				this.deps.view(),
				this.state,
				this.agentSearch.getValue(),
				delta,
			)
			if (next) this.update(next)
			return
		}
		const command = stepRowLevel({ ...this.rowCountInput(), delta })
		if (command.state) this.update(command.state)
	}

	/** Enter: choose, toggle, append, edit an agent, or open the surface. */
	private activate(): void {
		if (this.state.editor) return this.saveEditor()
		if (this.state.tab === 'agents') {
			const row = agentRows(this.deps.view())[this.state.cursor]
			if (row?.kind === 'open')
				return this.finish({ kind: 'open-agents' })
			if (row?.kind === 'pin') return this.openEditor(row.pin)
			return
		}
		this.run(activateRow(this.rowCountInput()))
	}

	/** The editor for one pinned agent, starting on the model it pins. */
	private openEditor(pin: AgentPin): void {
		this.agentSearch.setValue('')
		this.update(openEditorState(this.deps.view(), this.state, pin))
	}

	/**
	 * Enter in the editor: write the pin, or close an unchanged one. A failed
	 * write is the picker's to report; the editor stays open to retry.
	 */
	private saveEditor(): void {
		const next = editorCommitState(
			this.deps.view(),
			this.state,
			this.agentSearch.getValue(),
			this.deps.onAgentOverrideChange,
		)
		if (next) this.update(next)
	}

	/** Apply one row action: persist, adopt state, or close with a choice. */
	private run(command: PickerCommand): void {
		if (command.config) {
			this.deps.onConfigChange(command.config)
			this.invalidate()
			this.deps.onRender()
		}
		if (command.state) this.update(command.state)
		if (command.model)
			this.finish({
				kind: 'model',
				reference: command.model.reference,
				level: command.model.level,
			})
	}

	private finish(outcome: PickerOutcome): void {
		this.deps.onDone(outcome)
	}
}
