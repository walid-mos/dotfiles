/**
 * double-escape-clear - two Escapes in quick succession empty the prompt.
 *
 * A single Escape keeps its default behavior (interrupt while streaming,
 * cancel autocomplete, no-op when idle). The double-press only fires when the
 * editor is non-empty, so Escape+Escape on an empty editor still triggers
 * pi's built-in empty-editor action (tree/fork selector).
 *
 * Modules:
 *   escape-pacer.ts - Escape press timing (pure state, unit-tested)
 *   escape-editor.ts - editor handleInput interception
 */

import { CustomEditor } from '@earendil-works/pi-coding-agent'

import { registerEditorDecorator } from '../ui/editor-decorator.ts'

import { attachDoubleEscapeClear } from './escape-editor.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export default function doubleEscapeClear(pi: ExtensionAPI): void {
	registerEditorDecorator(
		pi,
		(tui, theme, keybindings) => new CustomEditor(tui, theme, keybindings),
		(base, keybindings) => {
			attachDoubleEscapeClear(base, keybindings)
			return base
		},
	)
}
