import assert from 'node:assert/strict'
import test, { after } from 'node:test'

import { getCapabilities, setCapabilities } from '@earendil-works/pi-tui'

import { renderAttachmentStrip } from '../extensions/prompt-attachments/attachment-strip.ts'
import { toImageAlias } from '../extensions/prompt-attachments/image-paths.ts'
import { scaledPreviewData } from '../extensions/prompt-attachments/image-preview.ts'

import { png } from './png-fixture.ts'

import type { TerminalCapabilities } from '@earendil-works/pi-tui'
import type { StripFrame } from '../extensions/prompt-attachments/attachment-strip.ts'
import type { PromptCapture } from '../extensions/prompt-attachments/image-paths.ts'
import type { PreviewSource } from '../extensions/prompt-attachments/preview-service.ts'

const ORIGINAL_CAPABILITIES = { ...getCapabilities() }

after(() => {
	setCapabilities(ORIGINAL_CAPABILITIES)
})

function forceCapabilities(images: TerminalCapabilities['images']): void {
	setCapabilities({ ...ORIGINAL_CAPABILITIES, images })
}

function capture(number: number): PromptCapture {
	return {
		type: 'image',
		data: 'aGk=',
		mimeType: 'image/png',
		alias: toImageAlias(number),
		filePath: `/tmp/pic-${number}.detailed-label-${number}.png`,
		imageId: number,
	}
}

type StripTheme = StripFrame['theme']

/** Pixel samples for fixture tiles: deterministic, layout-driven bands. */
function pixels(x: number, y: number): [number, number, number, number] {
	return [(x * 3) % 256, (y * 5) % 256, 40, 255]
}

/** Kitty anchors an image at the line carrying its `i=<id>` control chunk. */
function anchors(line: string | undefined, imageId: number): boolean {
	return line?.includes(`i=${imageId}`) ?? false
}

/** Identity theme: colors render as `role/content` to keep assertions readable. */
// Pi Theme is duck-typed through the fg/bold surface the strip renderer uses.
// oxlint-disable-next-line nextnode/no-type-assertion typescript/no-unsafe-type-assertion
const THEME = {
	// Identity render; not Tailwind classes despite the token-like strings.
	// oxlint-disable-next-line nextnode/no-detached-tailwind
	fg: (role: string, content: string) => `${role}/${content}`,
	// oxlint-disable-next-line nextnode/no-detached-tailwind
	bold: (content: string) => `b/${content}`,
} as StripTheme

/** A source whose previews never settle: names the placeholder path. */
function pendingSource(records: PromptCapture[] = []): PreviewSource {
	return {
		peek: () => undefined,
		request: record => records.push(record),
	}
}

/** A source with every preview warm; the strip renders images right away. */
function warmSource(base64 = 'aGk='): PreviewSource {
	return {
		peek: () => base64,
		request: () => {},
	}
}

function stripFrame(
	captures: readonly PromptCapture[],
	width: number,
	previews: PreviewSource,
): StripFrame {
	return { captures, scrollOffset: 0, width, theme: THEME, previews }
}

void test('renders the alias list when an image protocol is unavailable', () => {
	forceCapabilities(null)

	assert.deepEqual(
		renderAttachmentStrip(
			stripFrame([capture(1), capture(2)], 120, warmSource()),
		),
		// The aliased text only resembles Tailwind classes; it is an expectation.
		// oxlint-disable-next-line nextnode/no-detached-tailwind
		['dim/images [img:1] [img:2]'],
	)
})

void test('renders the alias list when the viewport is narrower than a tile', () => {
	forceCapabilities('kitty')

	assert.deepEqual(
		renderAttachmentStrip(stripFrame([capture(1)], 10, warmSource())),
		['dim/images [im'],
		'the compact alias list clips to the available columns',
	)
})

void test('renders a framed tile row when protocol and width allow', () => {
	forceCapabilities('kitty')

	const lines = renderAttachmentStrip(
		stripFrame([capture(1)], 40, warmSource()),
	)

	assert.ok(lines.length >= 4, 'edges, preview rows and a label line')
	assert.ok((lines[0] ?? '').includes('╭──────────╮'))
	assert.ok(lines[lines.length - 1]?.includes('[img:1]'))
	assert.ok(
		lines.every(line => !line.includes('images')),
		'no compact fallback line remains',
	)
})

void test('renders nothing without captures', () => {
	forceCapabilities('kitty')

	assert.deepEqual(
		renderAttachmentStrip(stripFrame([], 120, warmSource())),
		[],
	)
	assert.deepEqual(
		renderAttachmentStrip(stripFrame([], 20, warmSource())),
		[],
	)
})

void test('cold previews render placeholder frames and request their compute', () => {
	forceCapabilities('kitty')
	const records: PromptCapture[] = []

	const lines = renderAttachmentStrip(
		stripFrame([capture(1)], 40, pendingSource(records)),
	)

	assert.equal(
		records.length,
		1,
		'a cold preview is requested once on render',
	)
	assert.equal(records[0]?.imageId, 1)
	assert.ok(
		(lines[0] ?? '').includes('╭──────────╮'),
		'the frame still shows',
	)
	assert.ok(
		!(lines[1] ?? '').includes('pic-1.det'),
		'the placeholder name rides the bottom, not the top',
	)
	assert.ok(
		(lines[lines.length - 3] ?? '').includes('pic-1.det'),
		'the tile names the file on its last frame row, above the label',
	)
})

void test('placeholder tiles stay inside a single 10-column image tile', () => {
	forceCapabilities('kitty')

	const lines = renderAttachmentStrip(
		stripFrame([capture(1)], 40, pendingSource()),
	)

	const overwide = lines.filter(line => line.includes('detailed-label'))
	assert.equal(
		overwide.length,
		0,
		'the truncated filename keeps its columns off the tile',
	)
})

void test('placeholders hold the warm preview height: no strip reflow', () => {
	forceCapabilities('kitty')
	// 480x192 source downscales to 240x96: the warm tile stays below the cap.
	const source = png(480, 192, (x: number, y: number) => [
		(x * 4) % 256,
		(y * 9) % 256,
		80,
		255,
	])
	const capture1: PromptCapture = { ...capture(1), data: source, imageId: 1 }

	const pending = renderAttachmentStrip(
		stripFrame([capture1], 40, pendingSource()),
	)
	const warm = renderAttachmentStrip(
		stripFrame([capture1], 40, warmSource(scaledOf(source))),
	)

	assert.equal(
		pending.length,
		warm.length,
		'placeholder and settled preview occupy identical rows',
	)
	assert.ok(
		pending.length < 6,
		'a wide preview must fit below the cap for this parity test to bite',
	)
})

void test('short tiles bottom-align: image edges meet the alias labels', () => {
	forceCapabilities('kitty')
	// Tall (rows to the cap) beside wide (4 preview rows) exposes the padding.
	const tall: PromptCapture = {
		...capture(1),
		data: png(60, 300, pixels),
		imageId: 21,
	}
	// 400x250 downscales to ~230x144: four preview rows, two below the cap.
	const wide: PromptCapture = {
		...capture(2),
		data: png(400, 250, pixels),
		imageId: 22,
	}
	const warmByCaptureId = new Map([
		[tall.imageId, tall.data],
		[wide.imageId, wide.data],
	])
	const byId: PreviewSource = {
		peek: cap => warmByCaptureId.get(cap.imageId),
		request: () => {},
	}

	const lines = renderAttachmentStrip(stripFrame([tall, wide], 60, byId))

	// Preview rows run between the two edge lines; the label row closes it.
	// Kitty anchors an image at the line that carries its transmission chunk,
	// so bottom alignment has moved the short tile's anchor one row down.
	assert.equal(
		anchors(lines[1], tall.imageId),
		true,
		'row 1: the tall tile anchors at the top',
	)
	assert.equal(
		anchors(lines[1], wide.imageId),
		false,
		'row 1: the short tile starts blank, not top-anchored',
	)
	assert.equal(
		anchors(lines[3], wide.imageId),
		true,
		'row 3: the short tile anchors two rows down',
	)
	assert.equal(
		anchors(lines[3], tall.imageId),
		false,
		'row 3: no extra anchor on the tall tile',
	)
	assert.equal(
		anchors(lines[6], wide.imageId),
		false,
		'row 6: no re-anchor; kitty spans the cells below',
	)
	assert.equal(
		anchors(lines[6], tall.imageId),
		false,
		'row 6: no re-anchor on the tall tile either',
	)
	const labelRow = lines[lines.length - 1] ?? ''
	assert.ok(
		labelRow.includes('[img:1]') && labelRow.includes('[img:2]'),
		'labels stay directly under the bottom-aligned images',
	)
	// Both tiles' bottom rails share the row just above the labels: the
	// frames are exactly their capture's size, bottom-aligned.
	const bottomRails = (lines[lines.length - 2] ?? '').split('╰').length - 1
	assert.equal(bottomRails, 2, 'both frames end on the shared bottom row')
})

/** The strip warms from the scaled payload; the test scales the fixture once. */
function scaledOf(base64: string): string {
	return scaledPreviewData(base64, { widthPx: 240, heightPx: 144 })
}
