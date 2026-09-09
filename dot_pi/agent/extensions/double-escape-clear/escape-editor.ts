/** Make the second Escape of a quick pair empty the non-empty prompt. */

import { EscapePacer } from './escape-pacer.ts'

import type { KeybindingsManager } from '@earendil-works/pi-coding-agent'
import type { EditorComponent } from '@earendil-works/pi-tui'

/** pi-tui exposes autocomplete state on Editor subclasses only, not on the EditorComponent interface. */
type AutocompleteAwareEditor = EditorComponent & {
	isShowingAutocomplete?: () => boolean
}

/**
 * Rebind `handleInput` so two Escapes in quick succession clear the editor.
 *
 * Behaviour preserved per press:
 * - Escape with autocomplete open goes to the editor (closes the popup).
 * - Any other key resets the gesture.
 * - A second Escape clears only when the prompt is non-empty, so pi's
 *   built-in empty-editor double-Escape action and single-Escape interrupt
 *   stay untouched.
 *
 * `now` is injectable for deterministic tests.
 */
export function attachDoubleEscapeClear(
	editor: EditorComponent,
	keybindings: KeybindingsManager,
	now: () => number = Date.now,
): void {
	const pacer = new EscapePacer()
	const originalHandleInput = editor.handleInput.bind(editor)
	// pi-tui exposes no accessor for autocomplete state on the component
	// interface; the optional-method window is asserted deliberately (same
	// isolation point as inline-skills' editor trigger).
	// oxlint-disable-next-line nextnode/no-type-assertion typescript/no-unsafe-type-assertion
	const autocomplete = editor as AutocompleteAwareEditor
	const showsAutocomplete = (): boolean =>
		autocomplete.isShowingAutocomplete?.() ?? false
	// Rebinding is the sanctioned adapter hook for input interception.
	// oxlint-disable-next-line no-param-reassign
	editor.handleInput = (keyInput: string): void => {
		// Same pre-flight as pi's editor: interrupt key with no popup open.
		if (
			keybindings.matches(keyInput, 'app.interrupt') &&
			!showsAutocomplete()
		) {
			if (pacer.registerEscape(now()) && editor.getText().length > 0) {
				editor.setText('')
				return
			}
		} else {
			pacer.reset()
		}
		originalHandleInput(keyInput)
	}
}
