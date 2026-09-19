/**
 * model-fallback - what one terminal key asks the picker to do, decided over
 * the picker state alone.
 *
 * The component owns the pi-tui surface (focus, inputs, repaint); this module
 * owns the routing, so a key's meaning is testable without a terminal. Escape
 * stays with the component: what it does is a level of the picker's own
 * back-out ladder (search, editor, committed action, close).
 */

import { Key, matchesKey } from '@earendil-works/pi-tui'

import type { PickerState } from './model-picker-state.ts'

export type PickerKeyIntent =
	| { kind: 'switch-tab'; delta: number }
	| { kind: 'move'; delta: number }
	| { kind: 'effort'; delta: number }
	| { kind: 'activate' }
	| { kind: 'toggle-scope' }
	/** Save the highlighted row as the startup default for new sessions. */
	| { kind: 'save-default' }
	| { kind: 'reorder'; delta: number }
	| { kind: 'remove' }
	/** The key is text: the component sends it to the active search field. */
	| { kind: 'type' }

/** Cursor, tab and reasoning keys: where the cursor goes next. */
function cursorIntent(
	keyData: string,
	state: PickerState,
): PickerKeyIntent | undefined {
	if (!state.editor && matchesKey(keyData, Key.tab))
		return { kind: 'switch-tab', delta: 1 }
	if (!state.editor && matchesKey(keyData, Key.shift('tab')))
		return { kind: 'switch-tab', delta: -1 }
	if (matchesKey(keyData, Key.up)) return { kind: 'move', delta: -1 }
	if (matchesKey(keyData, Key.down)) return { kind: 'move', delta: 1 }
	if (matchesKey(keyData, Key.left)) return { kind: 'effort', delta: -1 }
	if (matchesKey(keyData, Key.right)) return { kind: 'effort', delta: 1 }
	return undefined
}

/**
 * Space toggles membership of the saved `enabledModels` list: on the scope tab
 * for its own row, and on the session catalogue for the highlighted model. The
 * session tab's search field therefore gives up one character - no model id
 * contains a space - so the key that edits the wanted list is the same one on
 * both lists.
 */
function spaceIntent(state: PickerState): PickerKeyIntent | undefined {
	if (state.editor) return undefined
	if (state.tab === 'scope' || state.tab === 'session')
		return { kind: 'toggle-scope' }
	return undefined
}

/** What commits, reorders or removes the row under the cursor. */
function rowIntent(
	keyData: string,
	state: PickerState,
): PickerKeyIntent | undefined {
	if (matchesKey(keyData, Key.enter)) return { kind: 'activate' }
	// Ctrl+S saves the highlighted catalogue row as the startup default, the
	// same key pi's own /model picker uses for it.
	if (
		!state.editor &&
		state.tab === 'session' &&
		matchesKey(keyData, Key.ctrl('s'))
	)
		return { kind: 'save-default' }
	if (matchesKey(keyData, Key.space)) return spaceIntent(state)
	if (matchesKey(keyData, Key.alt('up')))
		return { kind: 'reorder', delta: -1 }
	if (matchesKey(keyData, Key.alt('down')))
		return { kind: 'reorder', delta: 1 }
	// Backspace removes the highlighted row on the two list tabs that own a
	// removable list; elsewhere it is text.
	const removesRow = state.tab === 'fallbacks' || state.tab === 'scope'
	if (matchesKey(keyData, Key.backspace) && !state.editor && removesRow)
		return { kind: 'remove' }
	return undefined
}

/** The action a key asks for, or nothing when the key means nothing here. */
export function keyIntent(
	keyData: string,
	state: PickerState,
): PickerKeyIntent | undefined {
	const routed = cursorIntent(keyData, state) ?? rowIntent(keyData, state)
	if (routed) return routed
	if (state.editor || state.tab === 'session') return { kind: 'type' }
	return undefined
}
