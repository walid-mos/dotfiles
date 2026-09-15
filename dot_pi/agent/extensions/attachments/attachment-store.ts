/** Attachment state: aliases stay live only while the surface references them. */

import { IMAGE_ALIAS_PATTERN } from './image-paths.ts'
import { scanImageCaptures } from './path-scan.ts'

import type { ImageContent } from '@earendil-works/pi-ai'
import type { PromptCapture } from './image-paths.ts'

/** Aliases the given text still references. */
export function aliasesIn(text: string): Set<string> {
	return new Set(
		[...text.matchAll(IMAGE_ALIAS_PATTERN)].map(match => match[0]),
	)
}

export class AttachmentStore {
	private captures: PromptCapture[] = []
	private nextNumber = 1
	private offset = 0
	private readonly notifyChange: () => void

	constructor(notifyChange: () => void) {
		this.notifyChange = notifyChange
	}

	get items(): readonly PromptCapture[] {
		return this.captures
	}

	get scrollOffset(): number {
		return this.offset
	}

	/** Replace image paths in prompt text with [img:N] aliases. */
	ingestImagePaths(text: string, cwd: string): string {
		const scan = scanImageCaptures(text, cwd, this.nextNumber)
		if (!scan.captures.length) return text
		this.captures = [...this.captures, ...scan.captures]
		this.nextNumber += scan.captures.length
		this.notifyChange()
		return scan.rewritten
	}

	/** Drop captures whose alias is no longer present in the prompt text. */
	retainReferencedAliases(text: string): void {
		this.retainReferences(aliasesIn(text))
	}

	/**
	 * Drop captures whose alias is not in `referenced`. Surfaces whose text is
	 * spread across answers and drafts retain on their combined alias set.
	 */
	retainReferences(referenced: Set<string>): void {
		const retained = this.captures.filter(capture =>
			referenced.has(capture.alias),
		)
		if (retained.length === this.captures.length) return
		this.captures = retained
		this.offset = Math.min(this.offset, Math.max(0, retained.length - 1))
		if (!retained.length) this.nextNumber = 1
		this.notifyChange()
	}

	/** Captures whose alias is in `referenced`, in capture order. */
	referencedCapturesWithin(referenced: Set<string>): PromptCapture[] {
		return this.captures.filter(capture => referenced.has(capture.alias))
	}

	/** Captures the prompt text still references, in capture order. */
	referencedCaptures(text: string): PromptCapture[] {
		return this.referencedCapturesWithin(aliasesIn(text))
	}

	/** Multimodal payloads for the captures whose alias is in `referenced`. */
	imageAttachmentsWithin(referenced: Set<string>): ImageContent[] {
		return this.referencedCapturesWithin(referenced).map(
			({ data, mimeType }) => ({
				type: 'image' as const,
				data,
				mimeType,
			}),
		)
	}

	/** Multimodal payloads for every alias the prompt text still references. */
	imageAttachments(text: string): ImageContent[] {
		return this.imageAttachmentsWithin(aliasesIn(text))
	}

	/** Restore records a resumable surface persists; numbering continues after. */
	restoreCaptures(captures: readonly PromptCapture[]): void {
		if (!captures.length) return
		this.captures = [...this.captures, ...captures]
		this.nextNumber =
			Math.max(
				this.nextNumber,
				...captures.map(capture => aliasNumber(capture.alias)),
			) + 1
		this.notifyChange()
	}

	/** Consume the captures for a finished surface: strip and numbering reset. */
	clearCaptures(): void {
		if (!this.captures.length) return
		this.captures = []
		this.nextNumber = 1
		this.offset = 0
		this.notifyChange()
	}

	/** Scroll the strip preview; clamped when there is nothing to move. */
	scrollStrip(delta: number): void {
		const next = Math.max(
			0,
			Math.min(this.captures.length - 1, this.offset + delta),
		)
		if (next === this.offset) return
		this.offset = next
		this.notifyChange()
	}
}

/** The numeric part of a `[img:N]` alias, 0 when malformed. */
function aliasNumber(alias: string): number {
	const match = /\[img:(\d+)\]/u.exec(alias)
	return match ? Number.parseInt(match[1] ?? '', 10) : 0
}
