/**
 * prompt-attachments - image file paths in the prompt become [img:N] aliases.
 *
 * Image paths typed or pasted into the prompt are replaced with short aliases
 * ("~/d/diagram.png" -> "[img:1]") and attached to the message as real
 * multimodal images. A thumbnail strip above the prompt previews each capture
 * next to its alias (Ctrl+Shift+Left/Right scroll it); terminals without an
 * image protocol collapse the strip to the alias list. In the editor, aliases
 * render in accent bold and backspacing into a trailing alias removes it
 * whole.
 *
 * Modules:
 *   image-paths.ts       - file-system capture side: path parsing, mime sniffing
 *   attachment-store.ts  - capture state; aliases live while the text keeps them
 *   attachment-editor.ts - pi editor hooks (ingestion, alias deletion, styling)
 *   attachment-strip.ts  - thumbnail strip renderer
 */
import { CustomEditor } from '@earendil-works/pi-coding-agent'

import { registerEditorDecorator } from '../ui/editor-decorator.ts'
import {
	ABOVE_EDITOR_PRIORITY,
	setOrderedAboveEditorWidget,
} from '../ui/ordered-widget-stack.ts'

import { attachPromptImageEditor } from './attachment-editor.ts'
import { AttachmentStore } from './attachment-store.ts'
import { renderAttachmentStrip } from './attachment-strip.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionUIContext,
	KeybindingsManager,
} from '@earendil-works/pi-coding-agent'
import type { EditorComponent, EditorTheme, TUI } from '@earendil-works/pi-tui'
import type { AliasStylist } from './attachment-editor.ts'

const WIDGET_ID = 'prompt-attachments'
/** Shared no-op so reset code never allocates a new closure. */
const NO_REPAINT = (): void => {}

export default function promptAttachments(pi: ExtensionAPI): void {
	let repaintStrip: () => void = NO_REPAINT
	let styleAlias: AliasStylist = identityAlias
	let cwd = process.cwd()
	const store = new AttachmentStore(() => repaintStrip())

	pi.on('session_start', (_event, context) => {
		cwd = context.cwd
		styleAlias = accentAlias(context)
		repaintStrip = mountStripWidget(context.ui, store)
		repaintStrip()
		registerEditorDecorator(
			pi,
			defaultPromptEditor,
			(base, keybindings) => {
				attachPromptImageEditor(
					base,
					{
						store,
						cwd,
						styleAlias,
					},
					keybindings,
				)
				return base
			},
		)
	})

	pi.on('session_shutdown', (_event, context) => {
		setOrderedAboveEditorWidget(context.ui, WIDGET_ID, undefined)
		repaintStrip = NO_REPAINT
		styleAlias = identityAlias
	})

	// Attach every alias the submitted prompt still references.
	pi.on('input', event => {
		const images = store.imageAttachments(event.text)
		if (!images.length) return { action: 'continue' }
		return {
			action: 'transform',
			text: event.text,
			images: [...(event.images ?? []), ...images],
		}
	})

	pi.registerShortcut('ctrl+shift+left', scrollShortcut(store, -1, 'left'))
	pi.registerShortcut('ctrl+shift+right', scrollShortcut(store, 1, 'right'))
}

const identityAlias = (alias: string): string => alias

function accentAlias(context: ExtensionContext): AliasStylist {
	return alias => context.ui.theme.fg('accent', context.ui.theme.bold(alias))
}

function defaultPromptEditor(
	tui: TUI,
	theme: EditorTheme,
	keybindings: KeybindingsManager,
): EditorComponent {
	return new CustomEditor(tui, theme, keybindings)
}

/** Mount the strip widget; the returned repaint refreshes/clears it live. */
function mountStripWidget(
	ui: ExtensionUIContext,
	store: AttachmentStore,
): () => void {
	const repaint = (): void => {
		setOrderedAboveEditorWidget(
			ui,
			WIDGET_ID,
			store.items.length > 0
				? {
						priority: ABOVE_EDITOR_PRIORITY.attachments,
						render: (width, theme) =>
							renderAttachmentStrip(
								store.items,
								store.scrollOffset,
								width,
								theme,
							),
					}
				: undefined,
		)
	}
	repaint()
	return repaint
}

function scrollShortcut(
	store: AttachmentStore,
	delta: number,
	side: 'left' | 'right',
): { description: string; handler: () => void } {
	return {
		description: `Scroll prompt image strip ${side}`,
		handler: () => store.scrollStrip(delta),
	}
}
