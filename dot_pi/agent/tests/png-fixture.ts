/** PNG test fixtures: build real in-memory PNGs, read previews back. */

import { deflateSync, inflateSync } from 'node:zlib'

import { crc32 } from '../extensions/prompt-attachments/crc32.ts'
import {
	A_CHANNEL_OFFSET,
	B_CHANNEL_OFFSET,
	CHUNK_CRC_BYTES,
	CHUNK_LENGTH_BYTES,
	G_CHANNEL_OFFSET,
	IHDR_BIT_DEPTH_OFFSET,
	IHDR_COLOR_TYPE_OFFSET,
	IHDR_DATA_START,
	IHDR_HEIGHT_OFFSET,
	IHDR_PAYLOAD_BYTES,
	IHDR_WIDTH_OFFSET,
	PNG_SIGNATURE_HEX,
	RGBA_CHANNELS,
	SUPPORTED_BIT_DEPTH,
} from '../extensions/prompt-attachments/png-format.ts'

/** Sample layouts the fixture can produce, with their format facts. */
const LAYOUTS = {
	rgb: { colorType: 2, channels: 3 },
	rgba: { colorType: 6, channels: RGBA_CHANNELS },
	grayAlpha: { colorType: 4, channels: 2 },
} as const

/** Every fixture call defines its pixel function plus its sample layout. */
export type PngOptions = {
	readonly layout?: keyof typeof LAYOUTS
}

/**
 * Builds a real PNG in memory: signature, IHDR, IDAT, IEND; base64 out. The
 * pixel callback returns the samples the layout needs (unused ones ignored).
 */
export function png(
	width: number,
	height: number,
	pixel: (x: number, y: number) => [number, number, number, number],
	options: PngOptions = {},
): string {
	const { layout = 'rgba' } = options
	const { colorType, channels } = LAYOUTS[layout]
	const raw = deflateReady(width, height, pixel, channels)
	const ihdr = Buffer.alloc(IHDR_PAYLOAD_BYTES)
	ihdr.writeUInt32BE(width, IHDR_WIDTH_OFFSET)
	ihdr.writeUInt32BE(height, IHDR_HEIGHT_OFFSET)
	ihdr[IHDR_BIT_DEPTH_OFFSET] = SUPPORTED_BIT_DEPTH
	ihdr[IHDR_COLOR_TYPE_OFFSET] = colorType
	return Buffer.concat([
		signature(),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw)),
		chunk('IEND', Buffer.alloc(0)),
	]).toString('base64')
}

/** One filter marker row + `channels`-wide rows holding the pixels. */
function deflateReady(
	width: number,
	height: number,
	pixel: (x: number, y: number) => [number, number, number, number],
	channels: number,
): Buffer {
	const stride = width * channels
	const raw = Buffer.alloc(height * (stride + 1))
	for (let y = 0; y < height; y += 1) {
		const rowStart = y * (stride + 1)
		raw[rowStart] = 0
		for (let x = 0; x < width; x += 1) {
			raw.set(pixel(x, y).slice(0, channels), rowStart + 1 + x * channels)
		}
	}
	return raw
}

export function signature(): Buffer {
	return Buffer.from(PNG_SIGNATURE_HEX, 'hex')
}

/** Proper PNG chunk framing: length, then type, body and crc. */
export function chunk(type: string, body: Buffer): Buffer {
	const head = Buffer.alloc(CHUNK_LENGTH_BYTES)
	head.writeUInt32BE(body.length, 0)
	const crc = Buffer.alloc(CHUNK_CRC_BYTES)
	crc.writeUInt32BE(
		crc32(Buffer.concat([Buffer.from(type, 'ascii'), body])),
		0,
	)
	return Buffer.concat([head, Buffer.from(type, 'ascii'), body, crc])
}

/** Reads pixels back from our own filter-0 RGBA encoder output. */
export function pixelsOf(base64: string): {
	width: number
	height: number
	at: (x: number, y: number) => [number, number, number, number]
} {
	const file = Buffer.from(base64, 'base64')
	const width = file.readUInt32BE(IHDR_DATA_START + IHDR_WIDTH_OFFSET)
	const height = file.readUInt32BE(IHDR_DATA_START + IHDR_HEIGHT_OFFSET)
	const stride = width * RGBA_CHANNELS
	const rows = inflateSync(idatPayload(file))
	const at = (x: number, y: number): [number, number, number, number] => {
		const offset = y * (stride + 1) + 1 + x * RGBA_CHANNELS
		return [
			rows[offset] ?? 0,
			rows[offset + G_CHANNEL_OFFSET] ?? 0,
			rows[offset + B_CHANNEL_OFFSET] ?? 0,
			rows[offset + A_CHANNEL_OFFSET] ?? 0,
		]
	}
	return { width, height, at }
}

/** The IDAT payload bytes: type index minus its length field, framed by crc. */
function idatPayload(file: Buffer): Buffer {
	const typeIndex = file.indexOf('IDAT')
	const length = file.readUInt32BE(typeIndex - CHUNK_LENGTH_BYTES)
	return file.subarray(
		typeIndex + CHUNK_LENGTH_BYTES,
		typeIndex + CHUNK_LENGTH_BYTES + length,
	)
}
