import assert from 'node:assert/strict'
import test from 'node:test'

import { scaledPreviewData } from '../extensions/prompt-attachments/image-preview.ts'
import { pngSize } from '../extensions/prompt-attachments/png-decode.ts'
import {
	CHUNK_CRC_BYTES,
	CHUNK_LENGTH_BYTES,
	CHUNK_TYPE_BYTES,
} from '../extensions/prompt-attachments/png-format.ts'

import { chunk, png, pixelsOf } from './png-fixture.ts'

const BOX_4 = { widthPx: 4, heightPx: 4 }

void test('downscales a big png to the box, keeping quadrant structure', () => {
	// 8x8: 4px quadrant blocks red/lime/blue/yellow.
	const source = png(8, 8, (x, y) => {
		if (x < 4) return y < 4 ? [255, 0, 0, 255] : [0, 0, 255, 255]
		return y < 4 ? [0, 255, 0, 255] : [255, 255, 0, 255]
	})

	const preview = scaledPreviewData(source, BOX_4)

	const image = pixelsOf(preview)
	assert.equal(image.width, 4)
	assert.equal(image.height, 4)
	// 4px quadrant blocks halve to 2px: sampled corners stay pure colors.
	assert.deepEqual(image.at(0, 0), [255, 0, 0, 255])
	assert.deepEqual(image.at(3, 0), [0, 255, 0, 255])
	assert.deepEqual(image.at(0, 3), [0, 0, 255, 255])
	assert.deepEqual(image.at(3, 3), [255, 255, 0, 255])
})

void test('downscales color-type-2 (RGB) screenshots the same way', () => {
	// macOS screenshots are RGB, no alpha channel: 8x8 rgb quadrants.
	const source = png(
		8,
		8,
		(x, y) => {
			if (x < 4) return y < 4 ? [255, 0, 0, 0] : [0, 0, 255, 0]
			return y < 4 ? [0, 255, 0, 0] : [255, 255, 0, 0]
		},
		{ layout: 'rgb' },
	)

	const preview = scaledPreviewData(source, BOX_4)

	const image = pixelsOf(preview)
	// Opaque alpha is synthesized for color types without one.
	assert.deepEqual(image.at(0, 0), [255, 0, 0, 255])
	assert.deepEqual(image.at(3, 0), [0, 255, 0, 255])
	assert.deepEqual(image.at(0, 3), [0, 0, 255, 255])
	assert.deepEqual(image.at(3, 3), [255, 255, 0, 255])
})

void test('downscales gray+alpha keeping both gray and alpha', () => {
	// 8x8 gray+alpha: gray flips after the first row, alpha after the first
	// column, so each half-pixel box averages one bright and one dim line.
	// Pixel callbacks return samples in channel order: [gray, alpha] here.
	const source = png(
		8,
		8,
		(x, y) => {
			const gray = y < 1 ? 240 : 48
			const alpha = x < 1 ? 200 : 255
			return [gray, alpha, 0, 0]
		},
		{ layout: 'grayAlpha' },
	)

	const preview = scaledPreviewData(source, BOX_4)

	const image = pixelsOf(preview)
	assert.equal(image.at(0, 0)[0], 144, 'gray mixes 240 and 48 one row each')
	assert.equal(
		image.at(0, 0)[3],
		227,
		'alpha blends 200 and 255 one col each',
	)
	assert.equal(image.at(3, 3)[3], 255, 'a fully-opaque box stays opaque')
})

void test('keeps an image that already fits the box untouched', () => {
	const source = png(4, 2, () => [10, 20, 30, 255])

	assert.equal(
		scaledPreviewData(source, { widthPx: 64, heightPx: 64 }),
		source,
	)
})

void test('non-png payloads pass through unchanged', () => {
	const jpeg = 'aFdVQ2ttZXY='

	assert.equal(scaledPreviewData(jpeg, BOX_4), jpeg)
})

void test('a 4990x2294 screenshot-shaped image shrinks under the box cap', () => {
	// Screenshot-like bands compress the way real chrome does.
	const source = png(4990, 2294, (x, y) => [y % 256, x % 256, 60, 255])

	const preview = scaledPreviewData(source, { widthPx: 240, heightPx: 144 })

	const image = pixelsOf(preview)
	assert.ok(image.width <= 240, `width ${image.width} fits the box`)
	assert.ok(image.height <= 144, `height ${image.height} fits the box`)
	// 2.18 ratio survives: 4990/2294 stays width-limited.
	assert.ok(Math.abs(image.height / image.width - 2294 / 4990) < 0.02)
	assert.ok(
		preview.length < 80_000,
		`preview stays tiny: got ${preview.length} chars`,
	)
})

/**
 * Guard the fixture builder against framing regressions (the handoff corollary:
 * a chunk missing its crc reads garbage): the real reader must accept it.
 */
void test('fixture chunk framing decodes through the real reader', () => {
	const size = pngSize(
		Buffer.from(
			png(2, 2, () => [7, 8, 9, 255]),
			'base64',
		),
	)
	assert.deepEqual(size, { width: 2, height: 2 })
})

/** Chunk framing stays well-formed at odd lengths: length+type+body+crc. */
void test('fixture chunk header fits its body exactly', () => {
	const framed = chunk('tEXt', Buffer.from('x'))
	assert.equal(
		framed.length,
		CHUNK_LENGTH_BYTES + CHUNK_TYPE_BYTES + 1 + CHUNK_CRC_BYTES,
	)
})
