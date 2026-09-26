/**
 * The attachment snapshot replayed inside its submitted surface, above the text.
 *
 * A capture only lives while its alias stays in the producing editor, so the
 * persisted surface keeps its own snapshot: the prompt stores it as a custom
 * session entry carrying the alias, the source file and the tile-sized
 * preview; the questionnaire embeds it in its tool details. The prompt's
 * branded strip can be mounted inside the owning prompt by renderers/,
 * with standalone rendering as a fallback. Being a CustomEntry it never
 * enters the model context, and it is re-rendered from the session file on
 * resume.
 */

import { PROMPT_ATTACHMENT } from '../ui/prompt-attachment.ts'

import { renderAttachmentStrip } from './attachment-strip.ts'

import type { UserMessage } from '@earendil-works/pi-ai'
import type {
	CustomEntry,
	EntryRenderOptions,
	SessionEntry,
	Theme,
} from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'
import type { Static } from 'typebox'
import type { PromptAttachment } from '../ui/prompt-attachment.ts'
import type { CaptureRecordSchema } from './capture-record.ts'
import type { PromptCapture } from './image-paths.ts'
import type { PreviewSource } from './preview-service.ts'

/** Custom entry holding one prompt's transcript attachments. */
export const TRANSCRIPT_ENTRY_TYPE = 'prompt-attachments'

/** One capture as the transcript keeps it: enough to redraw its tile. */
export type TranscriptCapture = Static<typeof CaptureRecordSchema>

export type TranscriptAttachments = {
	readonly captures: readonly TranscriptCapture[]
}

const NO_CAPTURES: TranscriptAttachments = { captures: [] }

/**
 * The captures of the prompt being submitted, waiting for their transcript
 * home. They are snapshotted while the editor still holds them (warm previews,
 * aliases intact) and replayed once pi has persisted the message that carried
 * them, so the entry follows that message in the transcript and in the session
 * file alike.
 */
export class SubmittedCaptures {
	private pending: TranscriptAttachments = NO_CAPTURES

	snapshot(attachments: TranscriptAttachments): void {
		this.pending = attachments
	}

	/**
	 * Attachments to replay under the newest user message of `entries`, or
	 * nothing while that message is not on the branch yet: pi persists a prompt
	 * only at its own `message_end`, which some events precede, so an early call
	 * must cost nothing. Only the message that carried the snapshot retires it.
	 */
	take(entries: readonly SessionEntry[]): TranscriptAttachments | undefined {
		const message = latestUserMessage(entries)
		if (!message) return undefined
		const carried = capturesForMessage(message, this.pending)
		if (!carried.captures.length) return undefined
		this.pending = NO_CAPTURES
		return carried
	}

	/** Drop an unclaimed snapshot, e.g. when a run ends without reaching a provider. */
	clear(): void {
		this.pending = NO_CAPTURES
	}
}

/** Snapshot one live capture, preferring its warm tile-sized preview. */
export function transcriptCapture(
	capture: PromptCapture,
	preview: string | undefined,
): TranscriptCapture {
	return {
		alias: capture.alias,
		mimeType: capture.mimeType,
		filePath: capture.filePath,
		imageId: capture.imageId,
		data: preview ?? capture.data,
	}
}

/**
 * The part of a submitted snapshot that belongs to `message`: a snapshot is
 * only ever replayed under the prompt whose message still shows its aliases.
 */
export function capturesForMessage(
	message: UserMessage,
	attachments: TranscriptAttachments,
): TranscriptAttachments {
	const text = userMessageText(message)
	return {
		captures: attachments.captures.filter(capture =>
			text.includes(capture.alias),
		),
	}
}

/** Newest user message on the branch, if it has one. */
function latestUserMessage(
	entries: readonly SessionEntry[],
): UserMessage | undefined {
	for (const entry of entries.toReversed()) {
		if (entry.type !== 'message') continue
		if (entry.message.role !== 'user') continue
		return entry.message
	}
	return undefined
}

/** pi sends user content as plain text or as text/image blocks. */
function userMessageText(message: UserMessage): string {
	const { content } = message
	if (typeof content === 'string') return content
	return content
		.filter(part => part.type === 'text')
		.map(part => part.text)
		.join('')
}

export function renderTranscriptAttachments(
	entry: CustomEntry<TranscriptAttachments>,
	_options: EntryRenderOptions,
	theme: Theme,
): Component | undefined {
	const captures = entry.data?.captures
	if (!captures?.length) return undefined
	return new TranscriptStrip(captures, theme)
}

/** Static strip: the snapshot already carries everything a render needs. */
class TranscriptStrip implements PromptAttachment {
	readonly [PROMPT_ATTACHMENT] = true
	private readonly captures: readonly PromptCapture[]
	private readonly theme: Theme

	constructor(captures: readonly TranscriptCapture[], theme: Theme) {
		this.captures = captures.map(toPromptCapture)
		this.theme = theme
	}

	matchesPrompt(source: string): boolean {
		return this.captures.every(capture => source.includes(capture.alias))
	}

	invalidate(): void {
		// Pi requires this hook even for stateless renderers.
		return
	}

	render(width: number): string[] {
		return renderAttachmentStrip({
			captures: this.captures,
			scrollOffset: 0,
			width,
			theme: this.theme,
			previews: snapshotPreviews,
		})
	}
}

/** Snapshot payloads are already tile-sized: warm by construction. */
export const snapshotPreviews: PreviewSource = {
	peek: capture => capture.data,
	request: () => {},
}

export function toPromptCapture(capture: TranscriptCapture): PromptCapture {
	return { type: 'image', ...capture }
}
