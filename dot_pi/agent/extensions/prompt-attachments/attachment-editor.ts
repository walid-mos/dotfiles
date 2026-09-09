/** Wire attachment ingestion into the pi prompt editor instance. */

import { IMAGE_ALIAS_PATTERN } from './image-paths.ts'

import type { KeybindingsManager } from '@earendil-works/pi-coding-agent'
import type { EditorComponent } from '@earendil-works/pi-tui'
import type { AttachmentStore } from './attachment-store.ts'

/** Editable alias styling: accent + bold so [img:N] reads as a token. */
export type AliasStylist = (alias: string) => string

type AttachmentDecision = {
	store: AttachmentStore
	cwd: string
	styleAlias: AliasStylist
}

/** Trailing alias: backspacing into it removes the whole token. */
const IMAGE_ALIAS_PATTERN_END = /\[img:\d+\]$/u

/**
 * Attach image-path ingestion to an editor instance:
 *
 * - `onChange`: new image paths are rewritten to `[img:N]` aliases as they
 *   arrive (typing, paste, clipboard image); losing an alias to an edit drops
 *   its capture, while the submit-clear (`onChange('')`) keeps the captures
 *   alive for the input event and consumes them instead. Pruning skips empty
 *   text because pi-tui submitValue() clears before calling onSubmit.
 * - `handleInput`: backspacing within a trailing `[img:N]` removes the whole
 *   alias instead of just the last digit.
 * - `render`: aliases are styled through `styleAlias`.
 *
 * onChange is intercepted with accessors because pi reassigns `onChange` and
 * `onSubmit` on the editor (copying callbacks from the default editor) after
 * the editor factory runs; later reassignments must keep calling through.
 */
export function attachPromptImageEditor(
	editor: EditorComponent,
	decision: AttachmentDecision,
	keybindings: KeybindingsManager,
): EditorComponent {
	attachImageRewrite(editor, decision)
	attachAliasBackspace(editor, keybindings)
	attachAliasStyling(editor, decision.styleAlias)
	return editor
}

function attachImageRewrite(
	editor: EditorComponent,
	{ store, cwd }: AttachmentDecision,
): void {
	let isRewriting = false
	let upstreamChange: ((text: string) => void) | undefined = undefined
	// pi-tui submitValue() fires onChange('') BEFORE onSubmit(result): a clear
	// is a submit, not an edit, so pruning there would drop every capture
	// before the input event can attach them.
	const pruneUnreferenced = (text: string): void => {
		if (text) store.retainReferencedAliases(text)
	}
	const handleChange = (text: string): void => {
		if (isRewriting) {
			pruneUnreferenced(text)
			upstreamChange?.(text)
			return
		}
		const rewritten = store.ingestImagePaths(text, cwd)
		if (rewritten !== text) {
			// Our own setText fires onChange again; retain instead of re-ingesting.
			isRewriting = true
			try {
				editor.setText(rewritten)
			} finally {
				isRewriting = false
			}
			return
		}
		pruneUnreferenced(text)
		upstreamChange?.(text)
	}
	Object.defineProperty(editor, 'onChange', {
		get: () => handleChange,
		set: next => {
			upstreamChange = next
		},
		configurable: true,
	})
}

/** Backspace inside a trailing [img:N] alias deletes the whole alias. */
function attachAliasBackspace(
	editor: EditorComponent,
	keybindings: KeybindingsManager,
): void {
	const originalHandleInput = editor.handleInput.bind(editor)
	// Rebinding is the sanctioned adapter hook for input interception.
	// oxlint-disable-next-line no-param-reassign
	editor.handleInput = (keyInput: string): void => {
		const textBefore = editor.getText()
		const trailingAlias = IMAGE_ALIAS_PATTERN_END.exec(textBefore)
		originalHandleInput(keyInput)
		const deletedLastCharacter =
			keybindings.matches(keyInput, 'tui.editor.deleteCharBackward') &&
			editor.getText() === textBefore.slice(0, -1)
		if (deletedLastCharacter && trailingAlias) {
			editor.setText(textBefore.slice(0, trailingAlias.index))
		}
	}
}

/** Restyle alias tokens in every rendered editor line. */
function attachAliasStyling(
	editor: EditorComponent,
	styleAlias: AliasStylist,
): void {
	const originalRender = editor.render.bind(editor)
	// oxlint-disable-next-line no-param-reassign
	editor.render = (width: number): string[] =>
		originalRender(width).map(line =>
			line.replace(IMAGE_ALIAS_PATTERN, styleAlias),
		)
}
