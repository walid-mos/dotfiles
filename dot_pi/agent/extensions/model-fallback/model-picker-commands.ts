/**
 * model-fallback - what the picker's row actions do, as transitions over the
 * view and the state: switching the session model, toggling and editing the
 * chain, stepping a pending reasoning level. The component only translates a
 * key into one of these calls, so "what enter does" has one home and is decided
 * without a terminal.
 */

import { effectiveLevel, stepLevel } from './model-catalog.ts'
import {
	appendEntry,
	commitAction,
	moveCursor,
	removeEntry,
	reorderEntry,
	withPendingLevel,
} from './model-picker-state.ts'
import { fallbackRows, searchRows } from './model-picker-view.ts'

import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import type { ModelFallbackConfig } from './config.ts'
import type { PickerState } from './model-picker-state.ts'
import type { PickerView } from './model-picker-view.ts'

export interface CommandInput {
	view: PickerView
	state: PickerState
	/** The session tab's search text; irrelevant on the other tabs. */
	query: string
}

/** What one action changes: a state to adopt, a config to save, or a choice. */
export interface PickerCommand {
	state?: PickerState
	config?: ModelFallbackConfig
	/** The session model choice enter commits. */
	model?: { reference: string; level: ModelThinkingLevel | undefined }
}

/** Enter: choose the session model, toggle an option, or append a model. */
export function activateRow(input: CommandInput): PickerCommand {
	const { view, state } = input
	if (state.tab === 'session') {
		const row = searchRows(view, input.query)[state.cursor]
		if (!row) return {}
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
	if (state.tab !== 'fallbacks') return {}
	const row = fallbackRows(view)[state.cursor]
	if (row?.kind === 'toggle')
		return {
			config: { ...view.config, [row.field]: !row.isOn },
			state: commitAction(state),
		}
	if (row?.kind === 'candidate')
		return {
			config: {
				...view.config,
				chain: appendEntry(view.config.chain, row.reference),
			},
			state: commitAction(state),
		}
	return {}
}

/** Left/right change the *pending* reasoning level of the row under the cursor. */
export function stepRowLevel(
	input: CommandInput & { delta: number },
): PickerCommand {
	if (input.state.tab !== 'session') return {}
	const row = searchRows(input.view, input.query)[input.state.cursor]
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
