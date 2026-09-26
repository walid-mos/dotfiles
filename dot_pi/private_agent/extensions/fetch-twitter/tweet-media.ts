/** Collect media references (label + URL) from a FxTwitter status payload. */

import {
	fxtwitterArray,
	fxtwitterRecord,
	fxtwitterString,
} from './fx-payload.ts'
import { quoteChainStatuses, quoteDepthPrefix } from './quote-chain.ts'

import type { FxTwitterRecord } from './fx-payload.ts'

export type TweetMediaReference = { label: string; url: string }

type MediaCollectionState = {
	references: TweetMediaReference[]
	seenUrls: Set<string>
}

/**
 * Walk the root status, each status in the thread and their quote chains,
 * collecting each photo/GIF, video poster and fallback media, deduplicated
 * by URL.
 */
export function collectTweetMedia(
	payload: unknown,
	maximumMedia: number,
): TweetMediaReference[] {
	const root = fxtwitterRecord(payload)
	if (!root) return []
	const state: MediaCollectionState = { references: [], seenUrls: new Set() }
	collectChainedMedia(root.status, '', state)
	for (const [index, threadStatus] of (
		fxtwitterArray(root, 'thread') ?? []
	).entries()) {
		collectChainedMedia(threadStatus, `thread ${index + 1} `, state)
	}
	return state.references.slice(0, maximumMedia)
}

/** One status's own media plus its quote chain, under one shared prefix. */
function collectChainedMedia(
	rootStatus: unknown,
	statusPrefix: string,
	state: MediaCollectionState,
): void {
	for (const entry of quoteChainStatuses(rootStatus)) {
		const prefix = `${statusPrefix}${quoteDepthPrefix(entry.depth)}`
		const media = fxtwitterRecord(entry.status.media)
		collectPhotos(media, state, prefix)
		collectVideos(media, state, prefix)
		collectFallbackMedia(entry.status, media, state, prefix)
	}
}

function collectPhotos(
	media: FxTwitterRecord | undefined,
	state: MediaCollectionState,
	prefix: string,
): void {
	const photos = media?.photos
	if (!Array.isArray(photos)) return
	for (const [index, photo] of photos.entries()) {
		const photoRecord = fxtwitterRecord(photo)
		const kind =
			fxtwitterString(photoRecord, 'type') === 'gif' ? 'GIF' : 'photo'
		addUniqueMedia(
			state,
			fxtwitterString(photoRecord, 'url'),
			mediaLabel(
				prefix,
				kind,
				index + 1,
				fxtwitterString(photoRecord, 'altText'),
			),
		)
	}
}

function collectVideos(
	media: FxTwitterRecord | undefined,
	state: MediaCollectionState,
	prefix: string,
): void {
	const videos = media?.videos
	if (!Array.isArray(videos)) return
	for (const [index, video] of videos.entries()) {
		const videoRecord = fxtwitterRecord(video)
		addUniqueMedia(
			state,
			fxtwitterString(videoRecord, 'thumbnail_url'),
			`${prefix}video ${index + 1} poster`,
		)
	}
}

/** Poster frames found outside the video list (external links, mosaics, cards). */
function collectFallbackMedia(
	status: FxTwitterRecord,
	media: FxTwitterRecord | undefined,
	state: MediaCollectionState,
	prefix: string,
): void {
	const external = fxtwitterRecord(media?.external)
	addUniqueMedia(
		state,
		fxtwitterString(external, 'thumbnail_url'),
		`${prefix}external video poster`,
	)
	const photos = media?.photos
	if (!Array.isArray(photos) || !photos.length) {
		const mosaic = fxtwitterRecord(media?.mosaic)
		const formats = fxtwitterRecord(mosaic?.formats)
		addUniqueMedia(
			state,
			fxtwitterString(formats, 'jpeg') ?? fxtwitterString(mosaic, 'url'),
			`${prefix}mosaic`,
		)
	}
	const cardImage = fxtwitterRecord(fxtwitterRecord(status.card)?.image)
	addUniqueMedia(state, fxtwitterString(cardImage, 'url'), `${prefix}card`)
}

function addUniqueMedia(
	state: MediaCollectionState,
	url: string | undefined,
	label: string,
): void {
	if (!url || state.seenUrls.has(url)) return
	state.seenUrls.add(url)
	state.references.push({ label, url })
}

function mediaLabel(
	prefix: string,
	kind: string,
	position: number,
	alternativeText: string | undefined,
): string {
	const label = `${prefix}${kind} ${position}`
	return alternativeText ? `${label} (${alternativeText})` : label
}
