/**
 * prompt-attachments - image file paths in the prompt become [img:N] aliases.
 *
 * Image paths typed or pasted into the prompt are replaced with short aliases
 * ("~/d/diagram.png" -> "[img:1]") and attached to the message as real
 * multimodal images on submission, which consumes the draft (strip clears,
 * numbering resets). A thumbnail strip above the prompt previews each capture
 * next to its alias (Ctrl+Shift+Left/Right scroll it); terminals without an
 * image protocol collapse the strip to the alias list. In the editor, aliases
 * render in accent bold and backspacing into a trailing alias removes it
 * whole. The submitted captures are snapshotted into a custom session entry,
 * so the same strip is replayed under the message in the transcript and comes
 * back on resume without touching the model context.
 *
 * Modules:
 *   image-paths.ts       - file-system capture side: mime sniffing, capture read
 *   path-scan.ts         - token scan and spaced-path merging
 *   path-word.ts         - shell words and safe local-path boundaries
 *   png-format.ts        - shared PNG constants and the RGBA image type
 *   png-decode.ts        - bounded inflation and RGBA row traversal
 *   png-scanline.ts      - PNG scanline filter reversal
 *   png-colors.ts        - sample spreading: unfiltered rows to RGBA rows
 *   png-encode.ts        - PNG writer: filter-0 RGBA re-encode
 *   crc32.ts             - CRC-32 for chunk framing (used by png-encode)
 *   image-preview.ts     - preview compute: streamed box-average downscale
 *   preview-worker.ts    - worker-thread entry: job in, preview out
 *   preview-service.ts   - async orchestration: worker queue, warm cache
 *   attachment-store.ts  - capture state; aliases live while the text keeps them
 *   attachment-editor.ts - pi editor hooks (ingestion, alias deletion, styling)
 *   attachment-strip.ts  - thumbnail strip renderer (warm previews + placeholders)
 *   transcript-entry.ts  - submitted-capture snapshot + transcript entry renderer
 */
import { CustomEditor } from '@earendil-works/pi-coding-agent'

import { registerEditorDecorator } from '../ui/editor-decorator.ts'
import {
	ABOVE_EDITOR_PRIORITY,
	setOrderedAboveEditorWidget,
} from '../ui/ordered-widget-stack.ts'

import { attachPromptImageEditor } from './attachment-editor.ts'
import { AttachmentStore } from './attachment-store.ts'
import { renderAttachmentStrip, TILE_PREVIEW_BOX } from './attachment-strip.ts'
import { PreviewService } from './preview-service.ts'
import {
	renderTranscriptAttachments,
	SubmittedCaptures,
	TRANSCRIPT_ENTRY_TYPE,
	transcriptCapture,
} from './transcript-entry.ts'

import type { ImageContent } from '@earendil-works/pi-ai'
import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionUIContext,
	InputEvent,
	InputEventResult,
	KeybindingsManager,
} from '@earendil-works/pi-coding-agent'
import type { EditorComponent, EditorTheme, TUI } from '@earendil-works/pi-tui'
import type { AliasStylist } from './attachment-editor.ts'
import type { TranscriptAttachments } from './transcript-entry.ts'

const WIDGET_ID = 'prompt-attachments'
/** Shared no-op so reset code never allocates a new closure. */
const NO_REPAINT = (): void => {}

export default function promptAttachments(pi: ExtensionAPI): void {
	let repaintStrip: () => void = NO_REPAINT
	let styleAlias: AliasStylist = identityAlias
	let cwd = process.cwd()
	// Captures of the prompt being submitted, replayed under its own message.
	const submitted = new SubmittedCaptures()
	const store = new AttachmentStore(() => repaintStrip())
	pi.registerEntryRenderer<TranscriptAttachments>(
		TRANSCRIPT_ENTRY_TYPE,
		renderTranscriptAttachments,
	)
	// Previews compute off the UI thread: the strip renders warm tiles only,
	// and every settled computation repaints the strip it was asked for.
	// A fresh service per session keeps the worker a session-scoped resource.
	let previews: PreviewService = new PreviewService(
		() => repaintStrip(),
		TILE_PREVIEW_BOX,
	)

	pi.on('session_start', (_event, context) => {
		cwd = context.cwd
		styleAlias = accentAlias(context)
		previews = new PreviewService(() => repaintStrip(), TILE_PREVIEW_BOX)
		repaintStrip = mountStripWidget(context.ui, store, previews)
		repaintStrip()
		registerPromptEditorDecorators(pi, store, cwd, styleAlias)
	})

	pi.on('session_shutdown', async (_event, context) => {
		setOrderedAboveEditorWidget(context.ui, WIDGET_ID, undefined)
		repaintStrip = NO_REPAINT
		styleAlias = identityAlias
		await previews.dispose()
	})

	// Attach every alias the submitted prompt still references, then consume
	// the draft: the capture strip belongs to the editor submission lifecycle.
	// The transcript snapshot is taken first, while the previews are still warm.
	pi.on('input', event => {
		if (event.source !== 'interactive') return { action: 'continue' }
		submitted.snapshot(submittedAttachments(store, previews, event.text))
		const images = store.imageAttachments(event.text)
		store.clearCaptures()
		previews.reset()
		return transformPrompt(event, images)
	})

	// The transcript replays the captures under the message that carried them:
	// by the first turn pi has persisted that message, so the entry lands after
	// it in the transcript and in the session file alike.
	pi.on('turn_start', (_event, context) => {
		const carried = submitted.take(context.sessionManager.getBranch())
		if (carried) pi.appendEntry(TRANSCRIPT_ENTRY_TYPE, carried)
	})

	registerStripScrollShortcuts(pi, store)
}

/** Fold the captures into the prompt; without any, it passes through. */
function transformPrompt(
	event: InputEvent,
	images: readonly ImageContent[],
): InputEventResult {
	if (!images.length) return { action: 'continue' }
	return {
		action: 'transform',
		text: event.text,
		images: [...(event.images ?? []), ...images],
	}
}

/** Snapshot the captures the submitted text references, warm previews first. */
function submittedAttachments(
	store: AttachmentStore,
	previews: PreviewService,
	text: string,
): TranscriptAttachments {
	return {
		captures: store
			.referencedCaptures(text)
			.map(capture => transcriptCapture(capture, previews.peek(capture))),
	}
}

/** Ctrl+Shift+Left/Right scrolls the strip preview window. */
function registerStripScrollShortcuts(
	pi: ExtensionAPI,
	store: AttachmentStore,
): void {
	pi.registerShortcut('ctrl+shift+left', scrollShortcut(store, -1, 'left'))
	pi.registerShortcut('ctrl+shift+right', scrollShortcut(store, 1, 'right'))
}

const identityAlias = (alias: string): string => alias

/** Decoratory wiring sees the session-start facts it was registered with. */
function registerPromptEditorDecorators(
	pi: ExtensionAPI,
	store: AttachmentStore,
	cwd: string,
	styleAlias: AliasStylist,
): void {
	registerEditorDecorator(pi, defaultPromptEditor, (base, keybindings) => {
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
	})
}

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
	previews: PreviewService,
): () => void {
	const repaint = (): void => {
		setOrderedAboveEditorWidget(
			ui,
			WIDGET_ID,
			store.items.length > 0
				? {
						priority: ABOVE_EDITOR_PRIORITY.attachments,
						render: (width, theme) =>
							renderAttachmentStrip({
								captures: store.items,
								scrollOffset: store.scrollOffset,
								width,
								theme,
								previews,
							}),
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
