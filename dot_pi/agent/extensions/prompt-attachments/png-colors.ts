/** PNG colour mapping: spreads unfiltered sample rows into RGBA. */

import {
	COLOR_TYPE_GRAY,
	COLOR_TYPE_GRAY_ALPHA,
	COLOR_TYPE_PALETTE,
	G_CHANNEL_OFFSET,
	B_CHANNEL_OFFSET,
	A_CHANNEL_OFFSET,
	OPAQUE,
	PALETTE_ENTRY_BYTES,
	RGBA_CHANNELS,
} from './png-format.ts'

/** A PNG image header reduced to what the mapping branches on. */
export type PngHeader = {
	readonly width: number
	readonly height: number
	readonly colorType: number
	readonly channels: number
}

/** Gray+alpha images store exactly two samples per pixel. */
const GRAY_ALPHA_CHANNELS = 2

/**
 * Owns a reusable RGBA row buffer and maps unfiltered sample rows into it.
 * Streaming-friendly: one allocation serves the entire image decode.
 */
export class RgbaRowMapper {
	private readonly scratch: Uint8Array
	private readonly resolution: PngHeader
	private readonly palette: Buffer | undefined

	constructor(header: PngHeader, palette: Buffer | undefined) {
		this.resolution = header
		this.palette = palette
		this.scratch = new Uint8Array(header.width * RGBA_CHANNELS)
	}

	/** Maps one unfiltered sample line into the reused RGBA row. */
	map(line: Uint8Array): Uint8Array {
		const { width: pixels, colorType } = this.resolution
		if (colorType === COLOR_TYPE_GRAY) {
			return this.mapGrayRow(line, pixels)
		}
		if (colorType === COLOR_TYPE_GRAY_ALPHA) {
			return this.mapGrayAlphaRow(line, pixels)
		}
		if (colorType === COLOR_TYPE_PALETTE) {
			return this.mapPaletteRow(line, pixels)
		}
		return this.mapSampleRow(line, pixels)
	}

	/** Gray shares one sample among red, green and blue. */
	private mapGrayRow(line: Uint8Array, pixels: number): Uint8Array {
		const row = this.scratch
		for (let pixel = 0; pixel < pixels; pixel += 1) {
			const offset = pixel * RGBA_CHANNELS
			const gray = line[pixel] ?? 0
			row[offset] = gray
			row[offset + G_CHANNEL_OFFSET] = gray
			row[offset + B_CHANNEL_OFFSET] = gray
			row[offset + A_CHANNEL_OFFSET] = OPAQUE
		}
		return row
	}

	/** Gray+alpha rows carry the alpha byte as their second sample. */
	private mapGrayAlphaRow(line: Uint8Array, pixels: number): Uint8Array {
		const row = this.scratch
		for (let pixel = 0; pixel < pixels; pixel += 1) {
			const offset = pixel * RGBA_CHANNELS
			const source = pixel * GRAY_ALPHA_CHANNELS
			row[offset] = line[source] ?? 0
			row[offset + G_CHANNEL_OFFSET] = line[source] ?? 0
			row[offset + B_CHANNEL_OFFSET] = line[source] ?? 0
			row[offset + A_CHANNEL_OFFSET] = line[source + 1] ?? OPAQUE
		}
		return row
	}

	/** Palette indices resolve through the PLTE chunk's RGB triples. */
	private mapPaletteRow(line: Uint8Array, pixels: number): Uint8Array {
		const row = this.scratch
		const { palette } = this
		if (!palette) return row
		for (let pixel = 0; pixel < pixels; pixel += 1) {
			const offset = pixel * RGBA_CHANNELS
			const entry = (line[pixel] ?? 0) * PALETTE_ENTRY_BYTES
			row[offset] = palette[entry] ?? 0
			row[offset + G_CHANNEL_OFFSET] =
				palette[entry + G_CHANNEL_OFFSET] ?? 0
			row[offset + B_CHANNEL_OFFSET] =
				palette[entry + B_CHANNEL_OFFSET] ?? 0
			row[offset + A_CHANNEL_OFFSET] = OPAQUE
		}
		return row
	}

	/** Any sample layout: RGB expands opaque; RGBA keeps its alpha byte. */
	private mapSampleRow(line: Uint8Array, pixels: number): Uint8Array {
		const row = this.scratch
		const { channels } = this.resolution
		for (let pixel = 0; pixel < pixels; pixel += 1) {
			const offset = pixel * RGBA_CHANNELS
			const source = pixel * channels
			row[offset] = line[source] ?? 0
			row[offset + G_CHANNEL_OFFSET] =
				line[source + G_CHANNEL_OFFSET] ?? 0
			row[offset + B_CHANNEL_OFFSET] =
				line[source + B_CHANNEL_OFFSET] ?? 0
			row[offset + A_CHANNEL_OFFSET] =
				channels >= RGBA_CHANNELS
					? (line[source + A_CHANNEL_OFFSET] ?? OPAQUE)
					: OPAQUE
		}
		return row
	}
}
