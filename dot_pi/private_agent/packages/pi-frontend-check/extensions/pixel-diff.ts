// Exact PNG pixel comparison for two captured browser states. This is a hard
// visual gate, unlike the diagnostic component/style comparison in iso-diff.ts.
// Capture storage and metadata validation live in pixel-capture-store.ts.
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { launchBrowser, openContext } from './browser-launch.ts'
import {
	captureDir,
	captureName,
	loadCapture,
	pngDimensions,
	saveCapture,
} from './pixel-capture-store.ts'

import type { Page } from 'playwright-core'
import type { FrontendBrowser } from './browser.ts'
import type { PixelCapture } from './pixel-capture-store.ts'
import type { Config } from './schema.ts'

const MAX_IMAGE_BYTES = 25_165_824
/** A changed region up to this size is the signature of borders, offsets or anti-aliasing. */
const SMALL_REGION_PX = 4

/** Arguments handed to diffPngInPage across Playwright's serialization boundary. */
type PngDiffArgs = {
	first: string
	second: string
	width: number
	height: number
}

/** Where the changed pixels sit, in capture coordinates. */
type Bounds = { x: number; y: number; width: number; height: number }

type PngComparison = { changed: number; overlay: string; bounds: Bounds }

export async function capturePixels(
	browser: FrontendBrowser,
	name: string,
	options: { wait_for: string; selector?: string | undefined },
): Promise<string> {
	const slug = captureName(name)
	if (/^(?:body|html|\*)$/i.test(options.wait_for.trim()))
		throw new Error(
			'Use a state-specific wait_for locator, not body/html/*; a loading shell is not a comparable state.',
		)
	const { png, url, viewport, position } = await browser.capturePixelFrame(
		options.wait_for,
		options.selector,
	)
	if (png.length > MAX_IMAGE_BYTES)
		throw new Error('PNG exceeds the 24 MB capture limit.')
	const { width, height } = pngDimensions(png)
	await saveCapture(slug, {
		png,
		url,
		selector: options.selector ?? null,
		viewport,
		position,
		width,
		height,
	})
	return `Captured ${width}x${height} PNG at viewport ${viewport.width}x${viewport.height}: ${join(captureDir(), `${slug}.png`)}\nURL: ${url}\nCompare two captures with frontend_pixels mode=diff. A capture alone is not a parity verdict.`
}

/** Serialized into the page: decode both PNGs, count differing pixels and box them; red overlay when any. */
// oxlint-disable-next-line max-lines-per-function -- self-contained by serialization constraint
async function diffPngInPage({
	first,
	second,
	width,
	height,
}: PngDiffArgs): Promise<PngComparison> {
	const CHANNELS = 4,
		BLUE = 2,
		ALPHA = 3,
		RED = 255
	// This helper must stay inside the function serialized by Playwright.
	// oxlint-disable-next-line unicorn/consistent-function-scoping
	const decode = async (base64: string): Promise<ImageBitmap> => {
		const bytes = Uint8Array.from(atob(base64), character =>
			character.charCodeAt(0),
		)
		return createImageBitmap(new Blob([bytes], { type: 'image/png' }))
	}
	const [imageA, imageB] = await Promise.all([decode(first), decode(second)])
	const canvas = document.createElement('canvas')
	canvas.width = width
	canvas.height = height
	const ctx = canvas.getContext('2d', { willReadFrequently: true })
	if (!ctx) throw new Error('Could not create pixel comparison canvas.')
	ctx.drawImage(imageA, 0, 0)
	const pixelsA = ctx.getImageData(0, 0, width, height).data
	ctx.clearRect(0, 0, width, height)
	ctx.drawImage(imageB, 0, 0)
	const pixelsB = ctx.getImageData(0, 0, width, height).data
	const diff = ctx.createImageData(width, height)
	let changed = 0
	let minX = width,
		minY = height,
		maxX = -1,
		maxY = -1
	for (let index = 0; index < pixelsA.length; index += CHANNELS) {
		if (
			pixelsA[index] === pixelsB[index] &&
			pixelsA[index + 1] === pixelsB[index + 1] &&
			pixelsA[index + BLUE] === pixelsB[index + BLUE] &&
			pixelsA[index + ALPHA] === pixelsB[index + ALPHA]
		)
			continue
		changed += 1
		diff.data[index] = RED
		diff.data[index + ALPHA] = RED
		const pixel = index / CHANNELS
		const x = pixel % width
		const y = Math.floor(pixel / width)
		minX = Math.min(minX, x)
		minY = Math.min(minY, y)
		maxX = Math.max(maxX, x)
		maxY = Math.max(maxY, y)
	}
	imageA.close()
	imageB.close()
	const bounds =
		changed > 0
			? {
					x: minX,
					y: minY,
					width: maxX - minX + 1,
					height: maxY - minY + 1,
				}
			: { x: 0, y: 0, width: 0, height: 0 }
	if (!changed) return { changed, overlay: '', bounds }
	ctx.putImageData(diff, 0, 0)
	return {
		changed,
		overlay: canvas.toDataURL('image/png').split(',')[1] ?? '',
		bounds,
	}
}

// The browser callback must cross Playwright's serialization boundary self-contained.
async function comparePngs(
	page: Page,
	a: PixelCapture,
	b: PixelCapture,
): Promise<PngComparison> {
	return page.evaluate(diffPngInPage, {
		first: a.png.toString('base64'),
		second: b.png.toString('base64'),
		width: a.width,
		height: a.height,
	})
}

async function compareCapturedImages(
	a: PixelCapture,
	b: PixelCapture,
	config: Config,
	signal?: AbortSignal,
): Promise<PngComparison> {
	const browser = await launchBrowser(config)
	const cancel = (): void => void browser.close()
	signal?.addEventListener('abort', cancel)
	try {
		signal?.throwIfAborted()
		const context = await openContext(browser, config)
		try {
			const page = await context.newPage()
			return await comparePngs(page, a, b)
		} finally {
			await context.close()
		}
	} finally {
		signal?.removeEventListener('abort', cancel)
		await browser.close()
	}
}

export type PixelPair = {
	capturedA: string
	capturedB: string
	a: PixelCapture
	b: PixelCapture
}

export async function loadPixelPair(
	capturedA: string,
	capturedB: string,
): Promise<PixelPair> {
	if (capturedA === capturedB)
		throw new Error(
			'Capture names must differ: comparing a capture to itself cannot prove parity.',
		)
	const [a, b] = await Promise.all([
		loadCapture(capturedA),
		loadCapture(capturedB),
	])
	if (a.url === b.url)
		throw new Error(
			`Both captures came from ${a.url}; use distinct implementation and prototype URLs.`,
		)
	return { capturedA, capturedB, a, b }
}

/** Where the difference sits, so the next step is a measurement, not another capture. */
function describeRegion(a: PixelCapture, bounds: Bounds): string {
	const page = a.selector
		? ` (page x=${Math.round(a.position.x + bounds.x)}, y=${Math.round(a.position.y + bounds.y)})`
		: ''
	const hint =
		bounds.width <= SMALL_REGION_PX || bounds.height <= SMALL_REGION_PX
			? ' A strip this thin is typically a border width, a 1px offset or anti-aliasing: measure the computed styles and geometry of the elements under it (frontend_compare mode=capture + mode=diff, or frontend_eval) before recapturing.'
			: ''
	return `Changed region: ${bounds.width}x${bounds.height} at (${bounds.x},${bounds.y}) in the capture${page}.${hint}`
}

/**
 * Compare the admitted in-memory inputs; no re-read or model parity judgment.
 * Element captures compare by dimensions only: where the element sits in its
 * page (header height, scroll offset) is not part of its pixels.
 */
export async function runPixelDiff(
	{ a, b, capturedA, capturedB }: PixelPair,
	config: Config,
	signal?: AbortSignal,
): Promise<string> {
	if ((a.selector === null) !== (b.selector === null))
		throw new Error(
			`Capture kinds differ: ${capturedA} is ${a.selector ? 'an element' : 'a viewport'} capture and ${capturedB} is ${b.selector ? 'an element' : 'a viewport'} capture; recapture both with the same kind of scope.`,
		)
	if (
		a.viewport.width !== b.viewport.width ||
		a.viewport.height !== b.viewport.height
	)
		return `FAIL: viewports differ: ${capturedA} ${a.viewport.width}x${a.viewport.height} vs ${capturedB} ${b.viewport.width}x${b.viewport.height}. Recapture at the same viewport.`
	if (a.width !== b.width || a.height !== b.height)
		return `FAIL: capture dimensions differ: ${capturedA} ${a.width}x${a.height} vs ${capturedB} ${b.width}x${b.height}.\nImplementation: ${a.url}\nBaseline: ${b.url}`
	const comparison = await compareCapturedImages(a, b, config, signal)
	signal?.throwIfAborted()
	const total = a.width * a.height
	if (!comparison.changed)
		return `PASS: 0/${total} pixels differ (${a.width}x${a.height}).\nImplementation: ${a.url}\nBaseline: ${b.url}`
	const path = join(
		captureDir(),
		`${captureName(capturedA)}-vs-${captureName(capturedB)}.${randomUUID()}.diff.png`,
	)
	await writeFile(path, Buffer.from(comparison.overlay, 'base64'))
	return `FAIL: ${comparison.changed}/${total} pixels differ (${a.width}x${a.height}).\n${describeRegion(a, comparison.bounds)}\nImplementation: ${a.url}\nBaseline: ${b.url}\nDifference map (red = changed): ${path}`
}
