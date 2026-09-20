/**
 * model-fallback - what the picker's membership keys do to the saved
 * `enabledModels` list: enter and ctrl+x on the session catalogue and enter on
 * the scope tab add or take out one model's membership, ctrl+s saves the
 * startup default, alt+up/down moves one entry, backspace removes one
 * explicitly.
 *
 * Every edit carries the list the picker read, so the writer can refuse a stale
 * edit; `expected` is never a re-derivation. A wildcard is one entry that moves
 * whole: enter never expands it, backspace removes it whole.
 */

import { orderScopedRows } from './model-catalog.ts'
import { scopeRows } from './model-picker-scope-rows.ts'
import {
	appendEntry,
	commitAction,
	moveCursor,
	removeEntry,
	reorderEntry,
	selectRow,
} from './model-picker-state.ts'
import { savedScope, searchRows, sessionRows } from './model-picker-view.ts'

import type { CommandInput, PickerCommand } from './model-picker-commands.ts'
import type { ScopeListChange, ScopeListEdit } from './model-picker-settings.ts'
import type { PickerState } from './model-picker-state.ts'
import type { PickerView } from './model-picker-view.ts'

/**
 * One edit of the saved list, or nothing when the list did not move: every
 * scope edit shares the same guard, and `expected` is always the list the
 * picker read, so the writer can refuse an edit made against a stale file.
 */
function scopeEdit(
	view: PickerView,
	next: readonly string[],
	change: ScopeListChange,
): ScopeListEdit | undefined {
	const unchanged =
		next.length === view.patterns.length &&
		next.every((entry, index) => entry === view.patterns[index])
	if (unchanged) return undefined
	return { expected: view.patterns, next, change }
}

/** One membership edit, committed only when it changes the saved list. */
function membershipCommand(
	view: PickerView,
	state: PickerState,
	next: readonly string[],
	change: ScopeListChange,
): PickerCommand {
	const edit = scopeEdit(view, next, change)
	if (!edit) return {}
	return { scopeList: edit, state: commitAction(state) }
}

/** The index the toggled model takes once `next` is the saved order. */
function savedIndex(
	view: PickerView,
	query: string,
	reference: string,
	next: readonly string[],
): number {
	const ordered = orderScopedRows(searchRows(view, query), next)
	return Math.max(
		0,
		ordered.findIndex(row => row.reference === reference),
	)
}

/**
 * Whether the saved `enabledModels` list already covers one reference: an exact
 * entry naming it, or a pattern that matches it. A covered row is one this
 * session can run now, so enter switches to it instead of editing the list.
 */
export function isInCatalogueList(
	view: PickerView,
	reference: string,
): boolean {
	const membership = savedScope(view).get(reference)
	return Boolean(membership && (membership.exact || membership.pattern))
}

/**
 * Enter on a session catalogue row that is not in the Ctrl+P list yet: the
 * model joins it as its own exact entry, never as an expansion of a pattern it
 * matched. The saved order re-ranks the list, so the cursor follows the model
 * it acted on instead of landing on whichever row takes its index.
 */
export function saveCatalogueRow(input: CommandInput): PickerCommand {
	const { view, state, query } = input
	if (state.tab !== 'session' || state.editor) return {}
	const row = sessionRows(view, query)[state.cursor]
	if (!row) return {}
	const edit = scopeEdit(view, appendEntry(view.patterns, row.reference), {
		kind: 'added',
		entry: row.reference,
	})
	if (!edit) return {}
	return {
		scopeList: edit,
		state: commitAction(
			selectRow(state, savedIndex(view, query, row.reference, edit.next)),
		),
	}
}

/**
 * Ctrl+X on a session catalogue row: its own exact entry leaves the saved list.
 * A row a pattern covers has no exact entry, and that one entry stands for
 * every model it matches, so removing it stays the scope tab's explicit
 * `backspace` action rather than an edit made from a row it happens to match.
 */
export function unsaveCatalogueRow(input: CommandInput): PickerCommand {
	const { view, state, query } = input
	if (state.tab !== 'session' || state.editor) return {}
	const row = sessionRows(view, query)[state.cursor]
	if (!row) return {}
	const exact = savedScope(view).get(row.reference)?.exact
	if (!exact) return {}
	const edit = scopeEdit(view, removeEntry(view.patterns, exact.index), {
		kind: 'removed',
		entry: exact.entry,
	})
	if (!edit) return {}
	return {
		scopeList: edit,
		state: commitAction(
			selectRow(state, savedIndex(view, query, row.reference, edit.next)),
		),
	}
}

/**
 * Enter on the scope tab. An exact saved entry leaves the saved scope; a
 * resolved session model no saved entry names is appended as its own exact
 * entry. A wildcard is never touched from here: it is not one model, it moves
 * whole, and removing it stays the explicit `backspace` action the footer
 * labels.
 */
export function toggleScopeRow(input: CommandInput): PickerCommand {
	const { view, state } = input
	if (state.tab !== 'scope' || state.editor) return {}
	const row = scopeRows(view)[state.cursor]
	if (!row) return {}
	if (row.kind === 'session')
		return membershipCommand(
			view,
			state,
			appendEntry(view.patterns, row.entry.reference),
			{ kind: 'added', entry: row.entry.reference },
		)
	if (row.isPattern) return {}
	return membershipCommand(
		view,
		state,
		removeEntry(view.patterns, row.index),
		{ kind: 'removed', entry: row.entry },
	)
}

/**
 * `backspace` removes the highlighted saved entry, wildcards included: one
 * whole entry leaves the list, never an expansion into model references.
 */
export function removeScopeRow(input: CommandInput): PickerCommand {
	const { view, state } = input
	if (state.tab !== 'scope' || state.editor) return {}
	const row = scopeRows(view)[state.cursor]
	if (row?.kind !== 'entry') return {}
	return membershipCommand(
		view,
		state,
		removeEntry(view.patterns, row.index),
		{ kind: 'removed', entry: row.entry },
	)
}

/**
 * Alt+up/down on the scope tab move one saved entry: the order is the file's
 * own list, so a wildcard moves whole and no entry is expanded or dropped. A
 * resolved model no saved entry names is metadata and has no order to change.
 */
export function reorderScopeRow(
	input: CommandInput & { delta: number },
): PickerCommand {
	const { view, state } = input
	if (state.tab !== 'scope' || state.editor || input.delta === 0) return {}
	const rows = scopeRows(view)
	const row = rows[state.cursor]
	if (row?.kind !== 'entry') return {}
	// The ends are hard stops: an unchanged order is not an edit.
	const edit = scopeEdit(
		view,
		reorderEntry(view.patterns, row.index, input.delta),
		{ kind: 'reordered' },
	)
	if (!edit) return {}
	return {
		scopeList: edit,
		state: commitAction(moveCursor(state, input.delta, rows.length)),
	}
}
