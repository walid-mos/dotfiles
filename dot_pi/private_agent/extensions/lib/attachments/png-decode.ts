/** PNG reader: bounded inflation followed by row-wise RGBA mapping. */
import { inflateSync } from 'node:zlib'

import { RgbaRowMapper } from './png-colors.ts'
import {
	CHANNELS_BY_COLOR_TYPE,
	CHUNK_CRC_BYTES,
	CHUNK_DATA_OFFSET,
	CHUNK_LENGTH_BYTES,
	CHUNK_OVERHEAD_BYTES,
	CHUNK_TYPE_IDAT,
	CHUNK_TYPE_IEND,
	CHUNK_TYPE_PLTE,
	FILTER_MARKER_BYTES,
	FILTER_NONE,
	FILTER_PAETH,
	INTERLACE_NONE,
	IHDR_BIT_DEPTH_OFFSET,
	IHDR_COLOR_TYPE_OFFSET,
	IHDR_COMPRESSION_OFFSET,
	IHDR_DATA_START,
	IHDR_FILTER_OFFSET,
	IHDR_HEIGHT_OFFSET,
	IHDR_INTERLACE_OFFSET,
	IHDR_PAYLOAD_BYTES,
	IHDR_WIDTH_OFFSET,
	PNG_SIGNATURE_BYTES,
	PNG_SIGNATURE_HEX,
	SUPPORTED_BIT_DEPTH,
} from './png-format.ts'
import { unfilterLine } from './png-scanline.ts'

import type { PngHeader } from './png-colors.ts'

/** Preview budget only: original attachment bytes are never modified. */
const MAX_PREVIEW_SOURCE_PIXELS = 32_000_000
const MAX_PREVIEW_SOURCE_DIMENSION = 32_768
const HEADER_BYTES = IHDR_DATA_START + IHDR_PAYLOAD_BYTES + CHUNK_CRC_BYTES

export class PngDecodeError extends Error {}

/** Scratch pixels are reused: consume a row before the next visit. */
export type RgbaRow = {
	readonly width: number
	readonly y: number
	readonly rgba: Uint8Array
}

export type PngSize = { readonly width: number; readonly height: number }
export type RowVisitor = (row: RgbaRow) => void

/** Unknown, unsupported or over-budget headers have no preview size. */
export function pngSize(bytes: Buffer): PngSize | undefined {
	const header = readHeader(bytes)
	return header && { width: header.width, height: header.height }
}

/** Unsupported headers return false; corrupt compressed content throws PngDecodeError. */
export function visitPngRows(bytes: Buffer, visit: RowVisitor): boolean {
	const header = readHeader(bytes)
	if (!header) return false
	const { idat, palette } = collectChunks(bytes)
	const rowBytes = header.width * header.channels + FILTER_MARKER_BYTES
	streamRows(
		inflateRows(idat, header.height * rowBytes),
		header,
		palette,
		visit,
	)
	return true
}

function readHeader(bytes: Buffer): PngHeader | undefined {
	if (!hasSupportedHeader(bytes)) return undefined
	const width = bytes.readUInt32BE(IHDR_DATA_START + IHDR_WIDTH_OFFSET)
	const height = bytes.readUInt32BE(IHDR_DATA_START + IHDR_HEIGHT_OFFSET)
	const colorType = bytes[IHDR_DATA_START + IHDR_COLOR_TYPE_OFFSET] ?? 0
	const channels = CHANNELS_BY_COLOR_TYPE[colorType] ?? 0
	if (
		!channels ||
		!width ||
		!height ||
		width > MAX_PREVIEW_SOURCE_DIMENSION ||
		height > MAX_PREVIEW_SOURCE_DIMENSION ||
		width * height > MAX_PREVIEW_SOURCE_PIXELS
	)
		return undefined
	return { width, height, colorType, channels }
}

function hasSupportedHeader(bytes: Buffer): boolean {
	return (
		bytes.length >= HEADER_BYTES &&
		bytes.subarray(0, PNG_SIGNATURE_BYTES).toString('hex') ===
			PNG_SIGNATURE_HEX &&
		bytes.readUInt32BE(PNG_SIGNATURE_BYTES) === IHDR_PAYLOAD_BYTES &&
		bytes.toString(
			'ascii',
			PNG_SIGNATURE_BYTES + CHUNK_LENGTH_BYTES,
			IHDR_DATA_START,
		) === 'IHDR' &&
		bytes[IHDR_DATA_START + IHDR_BIT_DEPTH_OFFSET] ===
			SUPPORTED_BIT_DEPTH &&
		bytes[IHDR_DATA_START + IHDR_INTERLACE_OFFSET] === INTERLACE_NONE &&
		bytes[IHDR_DATA_START + IHDR_COMPRESSION_OFFSET] === FILTER_NONE &&
		bytes[IHDR_DATA_START + IHDR_FILTER_OFFSET] === FILTER_NONE
	)
}

function inflateRows(idat: Buffer, expectedBytes: number): Buffer {
	let raw: Buffer
	try {
		raw = inflateSync(idat, { maxOutputLength: expectedBytes })
	} catch (cause) {
		throw new PngDecodeError(
			'Cannot inflate PNG within its declared size; use the original image',
			{ cause },
		)
	}
	if (raw.length !== expectedBytes) {
		throw new PngDecodeError(
			`Expected ${expectedBytes} PNG row bytes, received ${raw.length}; use the original image`,
		)
	}
	return raw
}

type PngChunks = { readonly idat: Buffer; readonly palette: Buffer | undefined }

/** Collect views, then concatenate once: linear even for many IDAT chunks. */
function collectChunks(bytes: Buffer): PngChunks {
	const idat: Buffer[] = []
	let palette: Buffer | undefined = undefined
	let cursor = PNG_SIGNATURE_BYTES
	while (cursor + CHUNK_OVERHEAD_BYTES <= bytes.length) {
		const length = bytes.readUInt32BE(cursor)
		const type = bytes.readUInt32BE(cursor + CHUNK_LENGTH_BYTES)
		const end = cursor + CHUNK_OVERHEAD_BYTES + length
		if (end > bytes.length)
			throw new PngDecodeError(
				'Truncated PNG chunk; use the original image',
			)
		const content = bytes.subarray(
			cursor + CHUNK_DATA_OFFSET,
			end - CHUNK_CRC_BYTES,
		)
		if (type === CHUNK_TYPE_IDAT && length) idat.push(content)
		if (type === CHUNK_TYPE_PLTE) palette = content
		if (type === CHUNK_TYPE_IEND)
			return { idat: Buffer.concat(idat), palette }
		cursor = end
	}
	throw new PngDecodeError('Missing PNG end chunk; use the original image')
}

function streamRows(
	raw: Buffer,
	header: PngHeader,
	palette: Buffer | undefined,
	visit: RowVisitor,
): void {
	const stride = header.width * header.channels
	const rowBytes = stride + FILTER_MARKER_BYTES
	const mapper = new RgbaRowMapper(header, palette)
	let previous: Uint8Array | undefined = undefined
	for (let y = 0; y < header.height; y += 1) {
		const marker = y * rowBytes
		const filter = raw[marker] ?? FILTER_NONE
		if (filter > FILTER_PAETH)
			throw new PngDecodeError(
				`Unsupported PNG filter ${filter}; use the original image`,
			)
		previous = unfilterLine({
			line: raw.subarray(marker + FILTER_MARKER_BYTES, marker + rowBytes),
			stride,
			channels: header.channels,
			filter,
			previous,
		})
		visit({ width: header.width, y, rgba: mapper.map(previous) })
	}
}
