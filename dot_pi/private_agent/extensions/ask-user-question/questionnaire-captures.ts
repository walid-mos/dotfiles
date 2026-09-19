/**
 * Capture wiring for the live questionnaire dialog: the prompt strip's
 * scenario-neutral machinery made dialog-aware. Pasted image paths inside the
 * free-text editor become `[img:N]` aliases with a thumbnail strip above the
 * dialog body; captures stay live while any answer, draft or the editor still
 * cites their alias, ride with the submitted answers as real multimodal
 * images, and persist as snapshot records so the result replay shows the
 * strip beside the alias that references it.
 */

import {
	attachAliasBackspace,
	attachAliasStyling,
} from '../attachments/attachment-editor.ts'
import { AttachmentStore, aliasesIn } from '../attachments/attachment-store.ts'
import {
	renderAttachmentStrip,
	TILE_PREVIEW_BOX,
} from '../attachments/attachment-strip.ts'
import { PreviewService } from '../attachments/preview-service.ts'
import {
	toPromptCapture,
	transcriptCapture,
} from '../attachments/transcript-entry.ts'
import { uiTheme } from '../ui/design-system/theme.ts'

import { clipboardInsertion } from './questionnaire-clipboard.ts'

import type { ImageContent } from '@earendil-works/pi-ai'
import type { KeybindingsManager, Theme } from '@earendil-works/pi-coding-agent'
import type { EditorComponent } from '@earendil-works/pi-tui'
import type { TranscriptCapture } from '../attachments/transcript-entry.ts'
import type { Answer } from './questionnaire-model.ts'

/** The user-written texts submitted answers carry: labels plus custom texts. */
export function answerReferenceTexts(answers: readonly Answer[]): string[] {
	return answers.flatMap(answer => {
		const customText =
			answer.kind === 'multi' ? answer.customText : undefined
		return customText ? [answer.label, customText] : [answer.label]
	})
}

/** Every alias-bearing text the dialog still holds, current text included. */
export type ReferenceTexts = () => readonly string[]

/** Union of every alias the given texts still cite. */
function referencedAliases(texts: readonly string[]): Set<string> {
	const referenced = new Set<string>()
	for (const text of texts) {
		for (const alias of aliasesIn(text)) referenced.add(alias)
	}
	return referenced
}

const PASTE_IMAGE_ACTION = 'app.clipboard.pasteImage'
/** Shared no-op so late store events never allocate a fresh closure. */
const NO_REPAINT = (): void => {}

type DialogKeybindings = Pick<KeybindingsManager, 'matches'>

export class QuestionnaireCaptures {
	private readonly cwd: string
	private readonly store: AttachmentStore
	private readonly previews: PreviewService
	private repaintDialog: () => void = NO_REPAINT
	private isOpen = false
	private editor: EditorComponent | undefined
	private keybindings: DialogKeybindings | undefined

	constructor(cwd: string) {
		this.cwd = cwd
		this.store = new AttachmentStore(() => this.repaintDialog())
		this.previews = new PreviewService(
			() => this.repaintDialog(),
			TILE_PREVIEW_BOX,
		)
	}

	/** Only strip invalidations pass through; pruning always stays explicit. */
	bindRepaint(repaintDialog: () => void): void {
		this.repaintDialog = () => {
			if (this.isOpen) repaintDialog()
		}
	}

	/** Wire alias handling into the dialog editor: rewrite, backspace, styling. */
	attachDialogEditor(
		editor: EditorComponent,
		keybindings: DialogKeybindings,
		references: ReferenceTexts,
	): void {
		this.isOpen = true
		this.editor = editor
		this.keybindings = keybindings
		attachAliasStyling(editor, alias => this.styledAlias(alias))
		this.attachDialogRewrite(editor, keybindings, references)
	}

	/** Render strip lines above the dialog body at the dialog frame width. */
	stripLines(theme: Theme, width: number): string[] {
		return renderAttachmentStrip({
			captures: this.store.items,
			scrollOffset: this.store.scrollOffset,
			width,
			theme,
			previews: this.previews,
		})
	}

	get isStripVisible(): boolean {
		return this.store.items.length > 0
	}

	/** Ctrl+Shift+Left/Right scrolls the strip preview window. */
	canScrollStrip(): boolean {
		return this.isStripVisible
	}

	scrollStrip(delta: number): void {
		this.store.scrollStrip(delta)
	}

	/** Match the dialog Ctrl+V paste shortcut; false when the key is not it. */
	pasteImage(keyInput: string): boolean {
		const isPaste = this.keybindings?.matches(keyInput, PASTE_IMAGE_ACTION)
		if (!isPaste) return false
		void this.insertClipboardCapture()
		return true
	}

	/** Restore records a resumable dialog persists (chat redirect carries them). */
	restore(records: readonly TranscriptCapture[]): void {
		this.store.restoreCaptures(records.map(toPromptCapture))
	}

	/**
	 * Captures whose alias one of `texts` still cites, warm tiles preferred.
	 * Cold records keep the full payload so a chat redirect replays the strip
	 * before any preview settled.
	 */
	replayRecords(texts: readonly string[]): TranscriptCapture[] {
		const referenced = referencedAliases(texts)
		return this.store
			.referencedCapturesWithin(referenced)
			.map(capture =>
				transcriptCapture(capture, this.previews.peek(capture)),
			)
	}

	/** Full multimodal payloads for the submitted texts, for the model result. */
	modelAttachments(texts: readonly string[]): ImageContent[] {
		return this.store.imageAttachmentsWithin(referencedAliases(texts))
	}

	/**
	 * Align the store with the dialog's split text (answers, drafts, editor):
	 * drop captures nowhere referenced, renumber from one when none remain.
	 * No reference change costs nothing, so effect batches may call it often.
	 */
	prune(references: ReferenceTexts): void {
		this.store.retainReferences(referencedAliases(references()))
	}

	/** Release strip-side resources once the dialog is done with them. */
	async dispose(): Promise<void> {
		this.isOpen = false
		this.editor = undefined
		await this.previews.dispose()
	}

	private async insertClipboardCapture(): Promise<void> {
		const { editor } = this
		if (!editor) return
		const insertion = await clipboardInsertion()
		// The dialog may have closed or rebuilt its editor while we waited.
		if (!this.isOpen || this.editor !== editor || !insertion) return
		editor.insertTextAtCursor?.(insertion)
	}

	/**
	 * Dialog prune semantics: unlike the prompt, an emptied editor is not the
	 * whole text - answers and other drafts keep their captures - so prunes
	 * fire by combined references and only the dialog decides what has lost
	 * its alias. The submit-clear keeps captures: the answer being recorded
	 * right after still cites them.
	 */
	private attachDialogRewrite(
		editor: EditorComponent,
		keybindings: DialogKeybindings,
		references: ReferenceTexts,
	): void {
		const activeKeyInput = attachAliasBackspace(editor, keybindings)
		let isRewriting = false
		let upstreamChange: ((text: string) => void) | undefined
		const handleChange = (text: string): void => {
			if (isRewriting) {
				this.prune(references)
				upstreamChange?.(text)
				return
			}
			const rewritten = this.store.ingestImagePaths(text, this.cwd)
			if (rewritten !== text) {
				isRewriting = true
				try {
					editor.setText(rewritten)
				} finally {
					isRewriting = false
				}
				return
			}
			const isSubmitClear =
				!text &&
				keybindings.matches(activeKeyInput() ?? '', 'tui.input.submit')
			if (!isSubmitClear) this.prune(references)
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

	private styledAlias(alias: string): string {
		return uiTheme.fg('accent', uiTheme.bold(alias))
	}
}
