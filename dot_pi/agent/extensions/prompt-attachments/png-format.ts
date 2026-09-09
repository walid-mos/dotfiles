/** PNG file-format facts shared by the reader and the writer. */

/** Byte sequence common to every PNG file, as hex for an indexed compare. */
export const PNG_SIGNATURE_HEX = '89504e470d0a1a0a'
/** Signature length at the head of every PNG stream. */
export const PNG_SIGNATURE_BYTES = 8
/** First chunk payload (IHDR) begins after signature+length+type. */
export const IHDR_DATA_START = 16
/** IHDR payload is 13 field-bytes: size, depth, color, filters, interlace. */
export const IHDR_PAYLOAD_BYTES = 13
export const IHDR_WIDTH_OFFSET = 0
export const IHDR_HEIGHT_OFFSET = 4
export const IHDR_BIT_DEPTH_OFFSET = 8
export const IHDR_COLOR_TYPE_OFFSET = 9
export const IHDR_COMPRESSION_OFFSET = 10
export const IHDR_FILTER_OFFSET = 11
export const IHDR_INTERLACE_OFFSET = 12
/** Only 8-bit-depth, non-interlaced PNGs are decodable in previews. */
export const SUPPORTED_BIT_DEPTH = 8
export const INTERLACE_NONE = 0
/** PNG color types the codec can read. */
export const COLOR_TYPE_GRAY = 0
export const COLOR_TYPE_RGB = 2
export const COLOR_TYPE_PALETTE = 3
export const COLOR_TYPE_GRAY_ALPHA = 4
/** Output color type: 8-bit RGBA (what terminal image previews want). */
export const COLOR_TYPE_RGBA = 6
/** An RGBA pixel is always four bytes wide. */
export const RGBA_CHANNELS = 4
/** Fully opaque alpha byte for color types without an alpha channel. */
export const OPAQUE = 255
/** Byte offsets of G/B/A inside an RGBA pixel quad. */
export const G_CHANNEL_OFFSET = 1
export const B_CHANNEL_OFFSET = 2
export const A_CHANNEL_OFFSET = 3
/** Palette chunk: one RGB triple per palette index. */
export const PALETTE_ENTRY_BYTES = 3
/** Row filter marker occupying one byte before every scanline. */
export const FILTER_MARKER_BYTES = 1
/** Row filter 0: the row bytes are stored as written. */
export const FILTER_NONE = 0
/** Strictly increasing filter type codes from the PNG spec. */
export const FILTER_SUB = 1
export const FILTER_UP = 2
export const FILTER_AVERAGE = 3
export const FILTER_PAETH = 4
/** The average filter halves the sum of its two predictors. */
export const PAIR_DIVISOR = 2
/** Channel count per PNG color type. */
export const CHANNELS_BY_COLOR_TYPE: Record<number, number> = {
	[COLOR_TYPE_GRAY]: 1,
	[COLOR_TYPE_RGB]: 3,
	[COLOR_TYPE_PALETTE]: 1,
	[COLOR_TYPE_GRAY_ALPHA]: 2,
	[COLOR_TYPE_RGBA]: 4,
}
/** Chunk type codes. */
export const CHUNK_TYPE_IDAT = 0x49444154
export const CHUNK_TYPE_PLTE = 0x504c5445
export const CHUNK_TYPE_IEND = 0x49454e44
/** Chunk layout: 4 bytes length, type, payload, crc. */
export const CHUNK_LENGTH_BYTES = 4
export const CHUNK_TYPE_BYTES = 4
export const CHUNK_CRC_BYTES = 4
export const CHUNK_DATA_OFFSET = CHUNK_LENGTH_BYTES + CHUNK_TYPE_BYTES
export const CHUNK_OVERHEAD_BYTES = CHUNK_DATA_OFFSET + CHUNK_CRC_BYTES

/** A decoded RGBA pixel matrix, width*height*4 bytes, rows top to bottom. */
export type RgbaImage = {
	readonly width: number
	readonly height: number
	readonly pixels: Uint8Array
}
