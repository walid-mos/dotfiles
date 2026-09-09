/** Prompt attachment state: aliases stay live only while the prompt references them. */

import {
	ingestImagePathToken,
	IMAGE_ALIAS_PATTERN,
	SHELL_WORD,
} from './image-paths.ts'

import type { ImageContent } from '@earendil-works/pi-ai'
import type { PromptCapture } from './image-paths.ts'

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

	/** Replace image file paths in prompt text with [img:N] aliases. */
	ingestImagePaths(text: string, cwd: string): string {
		let hasIngested = false
		const rewritten = text.replace(SHELL_WORD, (token): string => {
			const ingest = ingestImagePathToken(token, cwd, this.nextNumber)
			if (!ingest) return token
			this.nextNumber += 1
			this.captures = [...this.captures, ingest.capture]
			hasIngested = true
			return ingest.replacement
		})
		if (hasIngested) this.notifyChange()
		return rewritten
	}

	/** Drop captures whose alias is no longer present in the prompt text. */
	retainReferencedAliases(text: string): void {
		const referenced = new Set(
			[...text.matchAll(IMAGE_ALIAS_PATTERN)].map(match => match[0]),
		)
		const retained = this.captures.filter(capture =>
			referenced.has(capture.alias),
		)
		if (retained.length === this.captures.length) return
		this.captures = retained
		this.offset = Math.min(this.offset, Math.max(0, retained.length - 1))
		if (!retained.length) this.nextNumber = 1
		this.notifyChange()
	}

	/** Multimodal payloads for every alias the prompt text still references. */
	imageAttachments(text: string): ImageContent[] {
		return this.captures
			.filter(capture => text.includes(capture.alias))
			.map(({ data, mimeType }) => ({ type: 'image', data, mimeType }))
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
