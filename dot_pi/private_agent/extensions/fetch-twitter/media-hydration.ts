/** Hydrate FxTwitter fetch results: images prepended to the tool result content. */

import { resizeImage } from '@earendil-works/pi-coding-agent'

import { fxtwitterRecord, parseFxtwitterPayload } from './fx-payload.ts'
import { fetchMediaBytes } from './media-download.ts'
import { statusQuoteTextNotes } from './status-quote-notes.ts'
import { collectTweetMedia } from './tweet-media.ts'

import type { ImageContent, TextContent } from '@earendil-works/pi-ai'
import type { TweetMediaReference } from './tweet-media.ts'

const MAX_IMAGES = 6
const MAX_IMAGE_WIDTH = 2_000
const MAX_IMAGE_HEIGHT = 2_000
const MAX_QUOTE_NOTE_TEXT_CHARACTERS = 500

export type ToolContent = ImageContent | TextContent

export type TweetImageResult =
	| {
			readonly isSuccess: true
			readonly data: string
			readonly width: number
			readonly height: number
			readonly mimeType: string
	  }
	| { readonly isSuccess: false; readonly error: string }

export type TweetImageFetcher = (
	url: string,
	signal: AbortSignal | undefined,
) => Promise<TweetImageResult>

type FetchedMedia = {
	readonly mediaReference: TweetMediaReference
	readonly image: TweetImageResult
}

/** Download one media URL and convert it for the model (bounded, resized). */
export async function fetchTweetImage(
	url: string,
	signal: AbortSignal | undefined,
): Promise<TweetImageResult> {
	const mediaBytes = await fetchMediaBytes(url, signal)
	if (!mediaBytes.isSuccess) return mediaBytes
	const resized = await resizeImage(mediaBytes.bytes, mediaBytes.mimeType, {
		maxWidth: MAX_IMAGE_WIDTH,
		maxHeight: MAX_IMAGE_HEIGHT,
	})
	if (!resized) return { error: 'could not decode', isSuccess: false }
	return {
		data: resized.data,
		width: resized.width,
		height: resized.height,
		mimeType: resized.mimeType,
		isSuccess: true,
	}
}

function toolText(content: readonly ToolContent[]): string {
	return content
		.filter((block): block is TextContent => block.type === 'text')
		.map(block => block.text)
		.join('\n')
}

function existingImageCount(details: unknown): number {
	const imageCount = fxtwitterRecord(details)?.imageCount
	if (typeof imageCount !== 'number' || imageCount < 0) return 0
	return imageCount
}

/** Successful downloads become image blocks; failures become note entries. */
function imageNotesFromFetches(fetchedMedia: readonly FetchedMedia[]): {
	images: ImageContent[]
	notes: string[]
} {
	const images: ImageContent[] = []
	const notes: string[] = []
	for (const { mediaReference, image } of fetchedMedia) {
		if (!image.isSuccess) {
			notes.push(`${mediaReference.label}: failed (${image.error})`)
			continue
		}
		images.push({
			type: 'image',
			data: image.data,
			mimeType: image.mimeType,
		})
		notes.push(`${mediaReference.label}: ${image.width}×${image.height}`)
	}
	return { images, notes }
}

/**
 * Given a fetch_content result whose text contains FxTwitter JSON, collect
 * its media URLs and return the content array with fetched images prepended
 * and a status note appended. Undefined when there is nothing to hydrate.
 */
export async function hydrateTweetMedia(
	content: readonly ToolContent[],
	details: unknown,
	signal: AbortSignal | undefined,
	fetchImage: TweetImageFetcher = fetchTweetImage,
): Promise<
	{ content: ToolContent[]; details: Record<string, unknown> } | undefined
> {
	const payload = parseFxtwitterPayload(toolText(content))
	const quoteTextNotes = payload
		? statusQuoteTextNotes(payload, MAX_QUOTE_NOTE_TEXT_CHARACTERS)
		: []
	const mediaReferences = payload
		? collectTweetMedia(payload, MAX_IMAGES)
		: []
	if (!mediaReferences.length) return undefined

	const fetchedMedia: FetchedMedia[] = await Promise.all(
		mediaReferences.map(async mediaReference => ({
			mediaReference,
			image: await fetchImage(mediaReference.url, signal),
		})),
	)
	const { images, notes } = imageNotesFromFetches(fetchedMedia)
	const noteTexts = [`Tweet media: ${notes.join('; ')}`]
	if (quoteTextNotes.length) {
		noteTexts.push(`Tweet quotes: ${quoteTextNotes.join('; ')}`)
	}
	return {
		content: [
			...images,
			...content,
			...noteTexts.map((text): TextContent => ({ type: 'text', text })),
		],
		details: {
			...fxtwitterRecord(details),
			hasImage: images.length > 0,
			imageCount: existingImageCount(details) + images.length,
			twitterMedia: notes,
			...(quoteTextNotes.length && { twitterQuotes: quoteTextNotes }),
		},
	}
}
