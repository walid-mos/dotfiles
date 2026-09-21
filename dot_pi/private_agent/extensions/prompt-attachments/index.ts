import { attachPromptImageEditor } from '../attachments/attachment-editor.ts'
import { AttachmentStore } from '../attachments/attachment-store.ts'
import {
	renderAttachmentStrip,
	TILE_PREVIEW_BOX,
} from '../attachments/attachment-strip.ts'
import { PreviewService } from '../attachments/preview-service.ts'
import {
	renderTranscriptAttachments,
	SubmittedCaptures,
	TRANSCRIPT_ENTRY_TYPE,
	transcriptCapture,
} from '../attachments/transcript-entry.ts'
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
 * so the same strip is replayed inside its prompt frame, above the text, and
 * comes back on resume without touching the model context. Without a matching
 * prompt frame, it retains its standalone transcript position.
 *
 * The scenario-neutral capture machinery lives in the shared `attachments/`
 * library (paths, PNG codec, previews, store, editor hooks, strip renderer,
 * snapshot records); this extension only wires it to the prompt lifecycle.
 */
import {
	createDefaultEditor,
	registerEditorDecorator,
} from '../ui/editor-decorator.ts'
import {
	ABOVE_EDITOR_PRIORITY,
	setOrderedAboveEditorWidget,
} from '../ui/ordered-widget-stack.ts'

import type { ImageContent } from '@earendil-works/pi-ai'
import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionUIContext,
	InputEvent,
	InputEventResult,
} from '@earendil-works/pi-coding-agent'
import type { AliasStylist } from '../attachments/attachment-editor.ts'
import type { TranscriptAttachments } from '../attachments/transcript-entry.ts'

const WIDGET_ID = 'prompt-attachments'
/** Shared no-op so reset code never allocates a new closure. */
const NO_REPAINT = (): void => {}

export default function promptAttachments(pi: ExtensionAPI): void {
	let repaintStrip: () => void = NO_REPAINT
	let styleAlias: AliasStylist = identityAlias
	let cwd = process.cwd()
	// Captures of the prompt being submitted, replayed with its own message.
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

	// Decorator registration must happen at load time, not inside session_start:
	// a listener added during session_start dispatch misses that same dispatch
	// (pi 0.86 event-bus semantics), so the editor would be built without the
	// alias decorator for the whole first session. The decorate closure reads
	// the session-scoped facts (cwd, styleAlias) at editor-build time instead.
	registerEditorDecorator(pi, createDefaultEditor, (base, keybindings) => {
		attachPromptImageEditor(base, { store, cwd, styleAlias }, keybindings)
		return base
	})

	pi.on('session_start', (_event, context) => {
		cwd = context.cwd
		styleAlias = accentAlias(context)
		previews = new PreviewService(() => repaintStrip(), TILE_PREVIEW_BOX)
		repaintStrip = mountStripWidget(context.ui, store, previews)
		repaintStrip()
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

	// Persist captures after the carrying message; raw-transcript/ mounts them inside its frame.
	// Not at `turn_start`: pi emits it before the prompt's own `message_end`, so
	// the branch still ends on the previous message there. `context` fires for
	// the provider call that follows the prompt's persistence - the message is
	// the leaf, and the entry still lands above the assistant's reply.
	pi.on('context', (_event, context) => {
		const carried = submitted.take(context.sessionManager.getBranch())
		if (carried) pi.appendEntry(TRANSCRIPT_ENTRY_TYPE, carried)
	})

	// A run that never reaches a provider call leaves the snapshot unclaimed.
	pi.on('agent_end', () => submitted.clear())

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

function accentAlias(context: ExtensionContext): AliasStylist {
	return alias => context.ui.theme.fg('accent', context.ui.theme.bold(alias))
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
