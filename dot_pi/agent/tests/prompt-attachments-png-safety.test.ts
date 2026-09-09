import assert from 'node:assert/strict'
import test from 'node:test'
import { deflateSync } from 'node:zlib'

import { scaledPreviewData } from '../extensions/prompt-attachments/image-preview.ts'
import { pngSize } from '../extensions/prompt-attachments/png-decode.ts'

import { chunk, pixelsOf, png, signature } from './png-fixture.ts'

const BOX = { widthPx: 1, heightPx: 1 }
const HEADER_START = 16
const HEADER_END = 29

function withCompressedRows(compressed: Buffer): string {
	const valid = Buffer.from(
		png(2, 2, () => [10, 20, 30, 255]),
		'base64',
	)
	return Buffer.concat([
		signature(),
		chunk('IHDR', valid.subarray(HEADER_START, HEADER_END)),
		chunk('IDAT', compressed),
		chunk('IEND', Buffer.alloc(0)),
	]).toString('base64')
}

void test('corrupt PNG compression leaves the original attachment intact', () => {
	const source = withCompressedRows(Buffer.from('not zlib'))
	assert.equal(scaledPreviewData(source, BOX), source)
})

void test('inflated rows must exactly match the declared image size', () => {
	// A 2x2 RGBA image needs 18 bytes, including its two filter markers.
	for (const rawLength of [9, 36]) {
		const source = withCompressedRows(deflateSync(Buffer.alloc(rawLength)))
		assert.equal(scaledPreviewData(source, BOX), source)
	}
})

void test('oversized or zero PNG dimensions are refused before pixel allocation', () => {
	for (const [width, height] of [
		[0, 2],
		[2, 0],
		[100_000, 1],
		[10_000, 10_000],
	]) {
		const source = Buffer.from(
			png(2, 2, () => [0, 0, 0, 255]),
			'base64',
		)
		source.writeUInt32BE(width ?? 0, HEADER_START)
		source.writeUInt32BE(height ?? 0, HEADER_START + 4)
		assert.equal(pngSize(source), undefined)
	}
})

void test('split IDAT chunks decode to the same known pixel color', () => {
	const valid = Buffer.from(
		png(2, 2, () => [10, 20, 30, 255]),
		'base64',
	)
	const raw = Buffer.from([
		0, 10, 20, 30, 255, 10, 20, 30, 255, 0, 10, 20, 30, 255, 10, 20, 30,
		255,
	])
	const pieces = [...deflateSync(raw)].map(byte =>
		chunk('IDAT', Buffer.from([byte])),
	)
	const source = Buffer.concat([
		signature(),
		chunk('IHDR', valid.subarray(HEADER_START, HEADER_END)),
		...pieces,
		chunk('IEND', Buffer.alloc(0)),
	]).toString('base64')
	assert.deepEqual(
		pixelsOf(scaledPreviewData(source, BOX)).at(0, 0),
		[10, 20, 30, 255],
	)
})
