/** Terminal preview side: shrink big PNG capture payloads to tile-size bytes. */

import { PngDecodeError, pngSize, visitPngRows } from './png-decode.ts'
import { encodePng } from './png-encode.ts'
import {
	A_CHANNEL_OFFSET,
	B_CHANNEL_OFFSET,
	G_CHANNEL_OFFSET,
	RGBA_CHANNELS,
} from './png-format.ts'

import type { RgbaRow } from './png-decode.ts'

/** Largest preview pixel size the renderer wants. */
export type ImageBox = {
	readonly widthPx: number
	readonly heightPx: number
}

/**
 * The pixel size of the preview that `scaledPreviewData` would produce, read
 * from the PNG header alone (IHDR is the mandated first chunk, so a 48-char
 * base64 probe covers it with no full decode). Size 0 there means unknown
 * (non-PNG capture).
 */
export function scaledPreviewSize(base64: string, box: ImageBox): ImageBox {
	const probe = Buffer.from(base64.slice(0, PNG_HEADER_PROBE_CHARS), 'base64')
	const source = pngSize(probe)
	if (!source) return UNKNOWN_PREVIEW_SIZE
	if (source.width <= box.widthPx && source.height <= box.heightPx) {
		return { widthPx: source.width, heightPx: source.height }
	}
	const fitted = fittingBox(source, box)
	return { widthPx: fitted.width, heightPx: fitted.height }
}

/**
 * Signature + chunk length/type + IHDR payload + crc: 33 bytes live inside
 * this base64 read.
 */
const PNG_HEADER_PROBE_CHARS = 48

/** The sentinel preview size the strip maps to its tallest fallback. */
const UNKNOWN_PREVIEW_SIZE: ImageBox = { widthPx: 0, heightPx: 0 }

/**
 * Base64 of a preview that fits the box (PNG in, PNG out) without dwarfing
 * the terminal renderer's tolerance. Non-decodable or already-small payloads
 * come back unchanged. Inflation is bounded; RGBA rows are streamed into the
 * destination so no full-resolution RGBA copy is held.
 */
export function scaledPreviewData(base64: string, box: ImageBox): string {
	const source = Buffer.from(base64, 'base64')
	const size = pngSize(source)
	if (!size) return base64
	if (size.width <= box.widthPx && size.height <= box.heightPx) return base64
	const target = fittingBox(size, box)
	const averager = new BoxAverager(size, target)
	try {
		visitPngRows(source, row => averager.add(row))
	} catch (error) {
		if (error instanceof PngDecodeError) return base64
		throw error
	}
	return encodePng({
		width: target.width,
		height: target.height,
		pixels: averager.result(),
	})
}

/** The minimal box that keeps the source aspect ratio inside the box. */
function fittingBox(
	source: { readonly width: number; readonly height: number },
	box: ImageBox,
): { readonly width: number; readonly height: number } {
	const scale = Math.min(
		box.widthPx / source.width,
		box.heightPx / source.height,
	)
	return {
		width: Math.max(1, Math.round(source.width * scale)),
		height: Math.max(1, Math.round(source.height * scale)),
	}
}

/**
 * Accumulates box-averaged destination pixels from streamed source rows.
 * Each destination box averages the pixels of its source rectangle, which
 * keeps the preview faithful when the box is far smaller than the source.
 */
class BoxAverager {
	private readonly sums: Uint32Array
	private readonly counts: Uint32Array
	private readonly target: { readonly width: number; readonly height: number }
	private readonly destRow: Uint16Array
	private readonly destCol: Uint16Array

	constructor(
		source: { readonly width: number; readonly height: number },
		target: { readonly width: number; readonly height: number },
	) {
		this.target = target
		this.destRow = boxMap(source.height, target.height)
		this.destCol = boxMap(source.width, target.width)
		this.sums = new Uint32Array(
			target.width * target.height * RGBA_CHANNELS,
		)
		this.counts = sampleCounts(source, target)
	}

	/** Adds every pixel of one streamed source row to its destination box. */
	add(row: RgbaRow): void {
		const destRow = this.destRow[row.y] ?? 0
		for (let x = 0; x < row.width; x += 1) {
			const slot =
				(destRow * this.target.width + (this.destCol[x] ?? 0)) *
				RGBA_CHANNELS
			const offset = x * RGBA_CHANNELS
			this.sums[slot] = (this.sums[slot] ?? 0) + (row.rgba[offset] ?? 0)
			this.sums[slot + G_CHANNEL_OFFSET] =
				(this.sums[slot + G_CHANNEL_OFFSET] ?? 0) +
				(row.rgba[offset + G_CHANNEL_OFFSET] ?? 0)
			this.sums[slot + B_CHANNEL_OFFSET] =
				(this.sums[slot + B_CHANNEL_OFFSET] ?? 0) +
				(row.rgba[offset + B_CHANNEL_OFFSET] ?? 0)
			this.sums[slot + A_CHANNEL_OFFSET] =
				(this.sums[slot + A_CHANNEL_OFFSET] ?? 0) +
				(row.rgba[offset + A_CHANNEL_OFFSET] ?? 0)
		}
	}

	/** Rounded copy of destination pixels: the averages are RGBA-ready. */
	result(): Uint8Array {
		const pixels = new Uint8Array(this.sums.length)
		for (let box = 0; box < this.counts.length; box += 1) {
			const count = this.counts[box] ?? 1
			const slot = box * RGBA_CHANNELS
			for (let channel = 0; channel < RGBA_CHANNELS; channel += 1) {
				pixels[slot + channel] =
					(this.sums[slot + channel] ?? 0) / count
			}
		}
		return pixels
	}
}

/** Pixels per destination box: their source rectangle area. */
function sampleCounts(
	source: { readonly width: number; readonly height: number },
	target: { readonly width: number; readonly height: number },
): Uint32Array {
	const counts = new Uint32Array(target.width * target.height)
	for (let dy = 0; dy < target.height; dy += 1) {
		const rowSpan = boxSpan(dy, target.height, source.height).length
		for (let dx = 0; dx < target.width; dx += 1) {
			counts[dy * target.width + dx] =
				rowSpan * boxSpan(dx, target.width, source.width).length
		}
	}
	return counts
}

/** The inclusive-exclusive source range one destination box covers. */
function boxSpan(
	index: number,
	targetLength: number,
	sourceLength: number,
): { readonly start: number; readonly length: number } {
	const start = Math.floor((index * sourceLength) / targetLength)
	const length = Math.max(
		1,
		Math.floor(((index + 1) * sourceLength) / targetLength) - start,
	)
	return { start, length }
}

/** Maps every source index onto the destination box covering it. */
function boxMap(sourceLength: number, targetLength: number): Uint16Array {
	const map = new Uint16Array(sourceLength)
	for (let box = 0; box < targetLength; box += 1) {
		const span = boxSpan(box, targetLength, sourceLength)
		for (
			let source = span.start;
			source < span.start + span.length;
			source += 1
		)
			map[source] = box
	}
	return map
}
