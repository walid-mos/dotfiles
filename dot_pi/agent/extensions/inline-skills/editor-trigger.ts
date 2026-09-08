/**
 * Auto-open the skill autocomplete when `/skill:` is typed mid-line.
 *
 * The built-in editor only auto-triggers autocomplete at line start. This
 * wraps `handleInput` so a printable keystroke that lands the cursor inside a
 * `/skill:` token opens the popup too (Escape closes it as usual).
 *
 * Editor `state` and `tryTriggerAutocomplete` are private in pi-tui, so they
 * are reached through one isolated, documented cast — the single point of
 * coupling to editor internals.
 */
import type { CustomEditor } from "@earendil-works/pi-coding-agent";
import { isSkillTokenContext } from "./token.ts";

/** Private Editor internals this trigger needs. */
type EditorInternals = {
	state: { lines: string[]; cursorLine: number; cursorCol: number };
	tryTriggerAutocomplete: () => void;
};

const PRINTABLE_ASCII_START = 0x20;
const PRINTABLE_ASCII_END = 0x7e;

/** Single printable ASCII character (excludes Esc, Tab, arrows, Enter…). */
function isPrintableAsciiChar(data: string): boolean {
	if (data.length !== 1) return false;
	const code = data.charCodeAt(0);
	return code >= PRINTABLE_ASCII_START && code <= PRINTABLE_ASCII_END;
}

export function installInlineSkillTrigger(editor: CustomEditor): void {
	const originalHandleInput = editor.handleInput.bind(editor);
	const internals = editor as unknown as EditorInternals;

	editor.handleInput = (data: string) => {
		originalHandleInput(data);
		if (!isPrintableAsciiChar(data)) return;

		const currentLine = internals.state.lines[internals.state.cursorLine] ?? "";
		const textBeforeCursor = currentLine.slice(0, internals.state.cursorCol);
		if (isSkillTokenContext(textBeforeCursor) && !editor.isShowingAutocomplete()) {
			internals.tryTriggerAutocomplete();
		}
	};
}
