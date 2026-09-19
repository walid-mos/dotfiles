/**
 * model-fallback - the picker's keyboard and mouse contract over pi-tui.
 *
 * The component owns no decisions: every key is routed by
 * `model-picker-keymap.ts` and then becomes a pure state transition
 * (`model-picker-state.ts`), a row action (`model-picker-commands.ts`), an
 * inline agent edit (`model-picker-editor.ts`), or one of the outcomes above.
 * Escape goes back one level at a time - search, editor, committed action,
 * tab - so a model or reasoning choice stays *pending* until enter and the
 * escape that finally closes the picker changes nothing.
 *
 * The search fields are pi's own `Input` (paste, Unicode, editing keys, IME
 * cursor) - one per filter, so neither inherits the other's text.
 */

import { Input, Key, matchesKey } from '@earendil-works/pi-tui'

import { agentRows } from './model-picker-agents.ts'
import {
	activateRow,
	removeChainRow,
	reorderRow,
	saveDefaultModel,
	stepAgentThinking,
	stepEffortState,
} from './model-picker-commands.ts'
import { editorCommitState, openEditorState } from './model-picker-editor.ts'
import { keyIntent } from './model-picker-keymap.ts'
import { searchLine } from './model-picker-line.ts'
import { renderPicker } from './model-picker-render.ts'
import { removeScopeRow, toggleScopeRow } from './model-picker-scope-edits.ts'
import {
	clampCursor,
	closeAgentEditor,
	escapeStep,
	initialPickerState,
	moveCursor,
	selectRow,
	switchTab,
} from './model-picker-state.ts'
import { activeQuery, activeRowCount, searchRows } from './model-picker-view.ts'

import type { Component, Focusable } from '@earendil-works/pi-tui'
import type { TuiMouseEvent, TuiMouseEventResult } from '@earendil-works/pi-tui'
import type { ModelFallbackConfig } from './config.ts'
import type { AgentEntry } from './model-picker-agents.ts'
import type { PickerCommand } from './model-picker-commands.ts'
import type { PickerKeyIntent } from './model-picker-keymap.ts'
import type { DefaultModelEdit } from './model-picker-settings.ts'
import type {
	AgentOverrideEdit,
	ScopeListEdit,
} from './model-picker-settings.ts'
import type { PickerOutcome, PickerState } from './model-picker-state.ts'
import type {
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
	/** Persisted as the saved scope list; false when the write failed. */
	onScopeListChange: (edit: ScopeListEdit) => boolean
	/** Persisted as the startup default for new sessions; false on failure. */
	onDefaultModelChange: (edit: DefaultModelEdit) => boolean
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
		const active = this.state.editor
			? this.agentSearch.getValue()
			: this.search.getValue()
		const lines = renderPicker({
			view,
			state: this.state,
			size: { width, height },
			query: this.search.getValue(),
			editorQuery: this.agentSearch.getValue(),
			searchLine: searchLine(
				this.state.editor ? this.agentSearch : this.search,
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
		const intent = keyIntent(keyData, this.state)
		if (intent) this.applyIntent(intent, keyData)
	}

	/** One routed key: the state transition, row action or text it asks for. */
	private applyIntent(intent: PickerKeyIntent, keyData: string): void {
		if (intent.kind === 'switch-tab')
			return this.update(switchTab(this.state, intent.delta))
		if (intent.kind === 'move') return this.move(intent.delta)
		if (intent.kind === 'effort') return this.stepEffort(intent.delta)
		if (intent.kind === 'activate') return this.activate()
		if (intent.kind === 'toggle-scope')
			return this.run(toggleScopeRow(this.rowCountInput()))
		if (intent.kind === 'save-default')
			return this.run(saveDefaultModel(this.rowCountInput()))
		if (intent.kind === 'reorder')
			return this.run(
				reorderRow({ ...this.rowCountInput(), delta: intent.delta }),
			)
		if (intent.kind === 'remove')
			return this.run(
				this.state.tab === 'fallbacks'
					? removeChainRow(this.rowCountInput())
					: removeScopeRow(this.rowCountInput()),
			)
		// `type`: the active search field owns the key, and the filtered list
		// may have shrunk under the cursor.
		if (this.state.editor) this.agentSearch.handleInput(keyData)
		else this.search.handleInput(keyData)
		this.move(0)
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type === 'wheel' && event.wheelDelta)
			return this.scrollBy(event.wheelDelta)
		if (event.type !== 'click' || event.button !== 'left') return undefined
		const pick = this.cache?.lines[event.y]?.pick
		const rows = activeRowCount(this.rowCountInput())
		if (typeof pick !== 'number' || pick >= rows) return undefined
		this.update(clampCursor(selectRow(this.state, pick), rows))
		// On the agents tab a click also does what the row under it is for.
		if (!this.state.editor && this.state.tab === 'agents') this.activate()
		return { handled: true }
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

	/** Left/right change the level of the row under the cursor. */
	private stepEffort(delta: number): void {
		// The agents tab writes the selected agent's own level as it steps.
		if (this.state.tab === 'agents' && !this.state.editor)
			return this.run(
				stepAgentThinking({ ...this.rowCountInput(), delta }),
			)
		const next = stepEffortState({
			view: this.deps.view(),
			state: this.state,
			query: this.search.getValue(),
			editorQuery: this.agentSearch.getValue(),
			delta,
		})
		if (next) this.update(next)
	}

	/** Enter: save an agent edit, choose a model, toggle, or open a surface. */
	private activate(): void {
		if (this.state.editor) {
			// A failed pin write is reported by the caller's own handler, and the
			// editor stays open to retry.
			const next = editorCommitState(
				this.deps.view(),
				this.state,
				this.agentSearch.getValue(),
				this.deps.onAgentOverrideChange,
			)
			if (next) this.update(next)
			return
		}
		if (this.state.tab === 'agents') {
			const row = agentRows(this.deps.view())[this.state.cursor]
			if (row?.kind === 'open')
				return this.finish({ kind: 'open-agents' })
			if (row?.kind === 'agent') return this.openEditor(row.entry)
			return
		}
		this.run(activateRow(this.rowCountInput()))
	}

	/** The editor for one agent, starting on the model it already runs. */
	private openEditor(entry: AgentEntry): void {
		this.agentSearch.setValue('')
		this.update(openEditorState(this.deps.view(), this.state, entry))
	}

	/** Apply one row action: persist, adopt state, or close with a choice. */
	private run(command: PickerCommand): void {
		if (command.config) {
			this.deps.onConfigChange(command.config)
			this.invalidate()
			this.deps.onRender()
		}
		// A refused write leaves the row, the cursor and the state as they were.
		if (
			command.scopeList &&
			!this.deps.onScopeListChange(command.scopeList)
		)
			return
		if (
			command.agentEdit &&
			!this.deps.onAgentOverrideChange(command.agentEdit)
		)
			return
		if (
			command.defaultEdit &&
			!this.deps.onDefaultModelChange(command.defaultEdit)
		)
			return
		if (command.state) {
			// The saved list can change under the cursor (a row moves between the
			// saved and session groups, or leaves the list) and closing the agent
			// editor changes which list the cursor is on: re-clamp against the
			// rows the next state actually has.
			const input = this.rowCountInput()
			const rows = activeRowCount({ ...input, state: command.state })
			this.update(clampCursor(command.state, rows))
		}
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
