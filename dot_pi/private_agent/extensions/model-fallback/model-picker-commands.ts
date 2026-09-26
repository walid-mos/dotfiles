/**
 * model-fallback - what the picker's row actions do, as transitions over the
 * view and the state: switching the session model, toggling and editing the
 * chain, stepping a pending reasoning level. The scope tab's own list edits
 * live in `model-picker-scope-edits.ts`; enter delegates to them. The component
 * only translates a key into one of these calls, so "what enter does" has one
 * home and is decided without a terminal.
 */

import { effectiveLevel, stepLevel } from './model-catalog.ts'
import { agentLevel, agentModelRow, agentRows } from './model-picker-agents.ts'
import { editorStepState } from './model-picker-editor.ts'
import { fallbackRows } from './model-picker-fallbacks.ts'
import {
	isInCatalogueList,
	reorderScopeRow,
	saveCatalogueRow,
	toggleScopeRow,
} from './model-picker-scope-edits.ts'
import {
	appendEntry,
	commitAction,
	moveCursor,
	removeEntry,
	reorderEntry,
	withPendingLevel,
} from './model-picker-state.ts'
import { sessionRows } from './model-picker-view.ts'

import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import type { ModelFallbackConfig } from './config.ts'
import type {
	AgentOverrideEdit,
	DefaultModelEdit,
	ScopeListEdit,
} from './model-picker-settings.ts'
import type { PickerState } from './model-picker-state.ts'
import type { PickerView } from './model-picker-view.ts'

export interface CommandInput {
	view: PickerView
	state: PickerState
	/** The session tab's search text; irrelevant on the other tabs. */
	query: string
}

/** What one action changes: a state to adopt, a save, or a choice. */
export interface PickerCommand {
	state?: PickerState
	config?: ModelFallbackConfig
	/** An edit of the saved scope list (`enabledModels`). */
	scopeList?: ScopeListEdit
	/** One agent's own thinking override, written on its own. */
	agentEdit?: AgentOverrideEdit
	/** The startup default the ctrl+s key saves (`defaultProvider`/`defaultModel`). */
	defaultEdit?: DefaultModelEdit
	/** The session model choice enter commits. */
	model?: { reference: string; level: ModelThinkingLevel | undefined }
}

/** Enter: run a saved model now, save an unsaved one, or toggle/append. */
export function activateRow(input: CommandInput): PickerCommand {
	const { view, state } = input
	if (state.tab === 'session') {
		const row = sessionRows(view, input.query)[state.cursor]
		if (!row) return {}
		// A model outside the list is not one this session runs yet: enter adds
		// it first (ctrl+x takes it back out), so a scope with no entries at all
		// can be built from this tab.
		if (!isInCatalogueList(view, row.reference))
			return saveCatalogueRow(input)
		// What the row displays is what the session gets, arrow or not.
		return {
			model: {
				reference: row.reference,
				level: effectiveLevel(
					row,
					state.levels.get(row.reference),
					view.sessionLevel,
				),
			},
		}
	}
	if (state.tab === 'scope') return toggleScopeRow(input)
	if (state.tab !== 'fallbacks') return {}
	const row = fallbackRows(view)[state.cursor]
	if (row?.kind === 'toggle')
		return {
			config: { ...view.config, [row.field]: !row.isOn },
			state: commitAction(state),
		}
	if (!(row?.kind === 'candidate'))
		return {}
	return {
			config: {
				...view.config,
				chain: appendEntry(view.config.chain, row.reference),
			},
			state: commitAction(state),
		}
}

/**
 * Left/right change the *pending* reasoning level of the row under the cursor.
 */
export function stepRowLevel(
	input: CommandInput & { delta: number },
): PickerCommand {
	if (input.state.tab !== 'session') return {}
	const row = sessionRows(input.view, input.query)[input.state.cursor]
	if (!row) return {}
	const current = effectiveLevel(
		row,
		input.state.levels.get(row.reference),
		input.view.sessionLevel,
	)
	const level = stepLevel(row.levels, current, input.delta)
	// A level the model does not accept, or the one it already shows, is no edit.
	if (!level || level === current) return {}
	return { state: withPendingLevel(input.state, row.reference, level) }
}

/**
 * Left/right on a row: the editor's pending level, or the session list's. The
 * agents tab is not here - its level belongs to the agent itself and is written
 * as it steps (`stepAgentThinking`).
 */
export function stepEffortState(input: {
	view: PickerView
	state: PickerState
	query: string
	editorQuery: string
	delta: number
}): PickerState | undefined {
	if (input.state.editor)
		return editorStepState(
			input.view,
			input.state,
			input.editorQuery,
			input.delta,
		)
	if (input.state.tab === 'agents') return undefined
	return stepRowLevel({
		view: input.view,
		state: input.state,
		query: input.query,
		delta: input.delta,
	}).state
}

/**
 * Left/right on the agents tab set the selected agent's own thinking level. The
 * level is written for that agent alone; its model key stays exactly as it was,
 * and a model the catalogue does not list has no levels to step through.
 */
export function stepAgentThinking(
	input: CommandInput & { delta: number },
): PickerCommand {
	const { view, state } = input
	if (state.tab !== 'agents' || state.editor) return {}
	const row = agentRows(view)[state.cursor]
	if (row?.kind !== 'agent') return {}
	const { entry } = row
	const modelRow = agentModelRow(view, entry.model)
	if (!modelRow || modelRow.levels.length <= 1) return {}
	const current = agentLevel(entry, modelRow)
	const level = stepLevel(modelRow.levels, current, input.delta)
	if (!level || level === current) return {}
	return {
		agentEdit: { agent: entry.name, thinking: level },
		state: commitAction(state),
	}
}

/**
 * Ctrl+S on a session row: the model the next session starts on. It is pi's
 * own default (`defaultProvider`/`defaultModel`, the keys pi's `/model` picker
 * writes with the same key), not this session's model - enter is what switches
 * that once the row is in the Ctrl+P list - and not the saved scope, which
 * enter and ctrl+x edit.
 */
export function saveDefaultModel(input: CommandInput): PickerCommand {
	const { view, state } = input
	if (state.tab !== 'session' || state.editor) return {}
	const row = sessionRows(view, input.query)[state.cursor]
	if (!row) return {}
	return {
		defaultEdit: { reference: row.reference },
		state: commitAction(state),
	}
}

/** Alt+up/down move a chain entry: it is the failover order, not a list. */
export function reorderChainRow(
	input: CommandInput & { delta: number },
): PickerCommand {
	const { view, state } = input
	if (state.tab !== 'fallbacks' || input.delta === 0) return {}
	const row = fallbackRows(view)[state.cursor]
	if (row?.kind !== 'chain') return {}
	const chain = reorderEntry(view.config.chain, row.index, input.delta)
	// The ends are hard stops: an unchanged order is not an edit.
	if (chain.every((entry, index) => entry === view.config.chain[index]))
		return {}
	return {
		config: { ...view.config, chain },
		state: commitAction(
			moveCursor(state, input.delta, fallbackRows(view).length),
		),
	}
}

/**
 * Alt+up/down always reorder the active tab's own list - the failover chain on
 * the fallbacks tab, the saved `enabledModels` entries on the scope tab.
 */
export function reorderRow(
	input: CommandInput & { delta: number },
): PickerCommand {
	if (!(input.state.tab === 'scope')) return reorderChainRow(input)
	return reorderScopeRow(input)
}

/** Backspace removes the chain entry under the cursor. */
export function removeChainRow(input: CommandInput): PickerCommand {
	const { view, state } = input
	const row = fallbackRows(view)[state.cursor]
	if (row?.kind !== 'chain') return {}
	return {
		config: {
			...view.config,
			chain: removeEntry(view.config.chain, row.index),
		},
		state: commitAction(
			moveCursor(state, 0, fallbackRows(view).length - 1),
		),
	}
}
