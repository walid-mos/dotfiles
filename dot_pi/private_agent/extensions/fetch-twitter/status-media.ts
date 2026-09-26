/** Embedded media stubs: what a status's own media contains, text-only. */

import {
	fxtwitterArray,
	fxtwitterRecord,
	fxtwitterString,
} from './fx-payload.ts'

import type { FxTwitterRecord } from './fx-payload.ts'

const MAX_ALT_TEXT_CHARACTERS = 1_000

export type MediaStub = {
	readonly photos?: number
	readonly gifs?: number
	readonly videos?: number
	readonly altTexts?: string[]
}

/** Counts and alt texts of the status's media; undefined when it has none. */
export function statusMediaStub(
	status: FxTwitterRecord,
): MediaStub | undefined {
	const media = fxtwitterRecord(status.media)
	if (!media) return undefined
	const photos = fxtwitterArray(media, 'photos') ?? []
	const videos = fxtwitterArray(media, 'videos') ?? []
	let photoCount = 0
	let gifCount = 0
	const altTexts: string[] = []
	for (const photo of photos) {
		const photoRecord = fxtwitterRecord(photo)
		if (fxtwitterString(photoRecord, 'type') === 'gif') {
			gifCount += 1
		} else {
			photoCount += 1
		}
		const altText = fxtwitterString(photoRecord, 'altText')
		if (altText) altTexts.push(altText.slice(0, MAX_ALT_TEXT_CHARACTERS))
	}
	if (!photoCount && !gifCount && !videos.length && !altTexts.length) {
		return undefined
	}
	return {
		...(photoCount && { photos: photoCount }),
		...(gifCount && { gifs: gifCount }),
		...(videos.length && { videos: videos.length }),
		...(altTexts.length && { altTexts }),
	}
}
