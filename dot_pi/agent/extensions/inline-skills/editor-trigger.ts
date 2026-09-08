import { isSkillTokenContext } from './token.ts'

/**
 * Auto-open the skill autocomplete when `/skill:` is typed mid-line.
 *
 * The built-in editor only auto-triggers autocomplete at line start. This
 * wraps `handleInput` so a printable keystroke that lands the cursor inside a
 * `/skill:` token opens the popup too (Escape closes it as usual).
 *
 * Editor `state` and `tryTriggerAutocomplete` are private in pi-tui, so they
 * are reached through one isolated, documented cast - the single point of
 * coupling to editor internals.
 */
import type { CustomEditor } from '@earendil-works/pi-coding-agent'

/** Private Editor internals this trigger needs. */
type EditorInternals = {
	state: { lines: string[]; cursorLine: number; cursorCol: number }
	tryTriggerAutocomplete: () => void
}

const PRINTABLE_ASCII_START = 0x20
const PRINTABLE_ASCII_END = 0x7e

/** Single printable ASCII character (excludes Esc, Tab, arrows, Enter…). */
function isPrintableAsciiChar(keyInput: string): boolean {
	if (keyInput.length !== 1) return false
	const code = keyInput.charCodeAt(0)
	return code >= PRINTABLE_ASCII_START && code <= PRINTABLE_ASCII_END
}

export function installInlineSkillTrigger(editor: CustomEditor): void {
	const originalHandleInput = editor.handleInput.bind(editor)
	// pi-tui exposes no accessor for editor internals; the duck-typed window
	// mirrors CustomEditor's private surface and is asserted deliberately.
	// oxlint-disable-next-line nextnode/no-type-assertion typescript/no-unsafe-type-assertion
	const internals = editor as unknown as EditorInternals

	// Rebinding handleInput is the sanctioned adapter hook for input interception.
	// oxlint-disable-next-line no-param-reassign
	editor.handleInput = (keyInput: string) => {
		originalHandleInput(keyInput)
		if (!isPrintableAsciiChar(keyInput)) return

		const currentLine =
			internals.state.lines[internals.state.cursorLine] ?? ''
		const textBeforeCursor = currentLine.slice(0, internals.state.cursorCol)
		if (
			isSkillTokenContext(textBeforeCursor) &&
			!editor.isShowingAutocomplete()
		) {
			internals.tryTriggerAutocomplete()
		}
	}
}
