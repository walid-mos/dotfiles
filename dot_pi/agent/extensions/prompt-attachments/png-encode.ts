/** PNG writer: re-encodes RGBA matrices as filter-0 8-bit PNGs. */

import { deflateSync } from 'node:zlib'

import { crc32 } from './crc32.ts'
import {
	COLOR_TYPE_RGBA,
	FILTER_MARKER_BYTES,
	FILTER_NONE,
	INTERLACE_NONE,
	IHDR_BIT_DEPTH_OFFSET,
	IHDR_COLOR_TYPE_OFFSET,
	IHDR_COMPRESSION_OFFSET,
	IHDR_FILTER_OFFSET,
	IHDR_HEIGHT_OFFSET,
	IHDR_INTERLACE_OFFSET,
	IHDR_PAYLOAD_BYTES,
	CHUNK_LENGTH_BYTES,
	CHUNK_CRC_BYTES,
	PNG_SIGNATURE_HEX,
	RGBA_CHANNELS,
	SUPPORTED_BIT_DEPTH,
} from './png-format.ts'

import type { RgbaImage } from './png-format.ts'

/** Re-encodes an RGBA matrix as an 8-bit filter-0 RGBA PNG, base64 out. */
export function encodePng(image: RgbaImage): string {
	return Buffer.concat([
		Buffer.from(PNG_SIGNATURE_HEX, 'hex'),
		pngChunk('IHDR', ihdrFor(image)),
		pngChunk('IDAT', deflateSync(filterRows(image))),
		pngChunk('IEND', Buffer.alloc(0)),
	]).toString('base64')
}

function ihdrFor(image: RgbaImage): Buffer {
	const ihdr = Buffer.alloc(IHDR_PAYLOAD_BYTES)
	ihdr.writeUInt32BE(image.width, 0)
	ihdr.writeUInt32BE(image.height, IHDR_HEIGHT_OFFSET)
	ihdr[IHDR_BIT_DEPTH_OFFSET] = SUPPORTED_BIT_DEPTH
	ihdr[IHDR_COLOR_TYPE_OFFSET] = COLOR_TYPE_RGBA
	ihdr[IHDR_COMPRESSION_OFFSET] = FILTER_NONE
	ihdr[IHDR_FILTER_OFFSET] = FILTER_NONE
	ihdr[IHDR_INTERLACE_OFFSET] = INTERLACE_NONE
	return ihdr
}

function filterRows(image: RgbaImage): Buffer {
	const stride = image.width * RGBA_CHANNELS
	const raw = Buffer.alloc(image.height * (stride + FILTER_MARKER_BYTES))
	for (let row = 0; row < image.height; row += 1) {
		raw[row * (stride + FILTER_MARKER_BYTES)] = FILTER_NONE
		raw.set(
			image.pixels.subarray(row * stride, (row + 1) * stride),
			row * (stride + FILTER_MARKER_BYTES) + FILTER_MARKER_BYTES,
		)
	}
	return raw
}

function pngChunk(type: string, content: Buffer): Buffer {
	const typeBuffer = Buffer.from(type, 'ascii')
	const head = Buffer.alloc(CHUNK_LENGTH_BYTES)
	head.writeUInt32BE(content.length, 0)
	const crc = Buffer.alloc(CHUNK_CRC_BYTES)
	crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, content])), 0)
	return Buffer.concat([head, typeBuffer, content, crc])
}
