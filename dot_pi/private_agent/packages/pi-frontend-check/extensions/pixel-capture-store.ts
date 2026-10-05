// Stored pixel-capture state: the exact PNG plus the metadata a comparison
// needs (URL, scope selector, viewport, region position, dimensions). Owned by
// capture-pixels; consumed by pixel-diff.ts for the exact channel comparison.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { getAgentDir } from '@earendil-works/pi-coding-agent'

const MAX_IMAGE_BYTES = 25_165_824
const MAX_PIXELS = 33_554_432
const PNG_WIDTH_OFFSET = 16
const PNG_HEIGHT_OFFSET = 20
const PNG_HEADER_BYTES = 24
const PNG_SIGNATURE_BYTES = 8
const PNG_SIGNATURE = '89504e470d0a1a0a'

export type PixelCapture = {
	png: Buffer
	url: string
	selector: string | null
	viewport: { width: number; height: number }
	position: { x: number; y: number }
	width: number
	height: number
}

export function captureDir(): string {
	return join(getAgentDir(), 'frontend-check', 'pixels')
}

export function captureName(name: string): string {
	if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(name))
		throw new Error(
			`Invalid capture name "${name}": use lowercase letters, digits, . _ -, max 80 characters.`,
		)
	return name
}

export function pngDimensions(png: Buffer): {
	width: number
	height: number
} {
	if (
		png.length < PNG_HEADER_BYTES ||
		png.subarray(0, PNG_SIGNATURE_BYTES).toString('hex') !== PNG_SIGNATURE
	)
		throw new Error('Captured image is not a PNG.')
	const width = png.readUInt32BE(PNG_WIDTH_OFFSET)
	const height = png.readUInt32BE(PNG_HEIGHT_OFFSET)
	if (!width || !height || width * height > MAX_PIXELS)
		throw new Error(
			`PNG dimensions ${width}x${height} exceed the pixel comparison limit.`,
		)
	return { width, height }
}

/** Persist one capture with the metadata a later comparison validates against. */
export async function saveCapture(
	slug: string,
	capture: PixelCapture,
): Promise<void> {
	const dir = captureDir()
	await mkdir(dir, { recursive: true })
	await writeFile(join(dir, `${slug}.png`), capture.png)
	await writeFile(
		join(dir, `${slug}.json`),
		JSON.stringify({
			url: capture.url,
			selector: capture.selector,
			viewport: capture.viewport,
			position: capture.position,
			width: capture.width,
			height: capture.height,
		}),
	)
}

function viewportOf(
	raw: unknown,
	name: string,
): { width: number; height: number } {
	if (
		!raw ||
		typeof raw !== 'object' ||
		!('width' in raw) ||
		typeof raw.width !== 'number' ||
		!('height' in raw) ||
		typeof raw.height !== 'number'
	)
		throw new Error(
			`Capture ${name} has invalid viewport metadata; recapture this state.`,
		)
	return { width: raw.width, height: raw.height }
}

function positionOf(raw: unknown, name: string): { x: number; y: number } {
	if (
		!raw ||
		typeof raw !== 'object' ||
		!('x' in raw) ||
		typeof raw.x !== 'number' ||
		!('y' in raw) ||
		typeof raw.y !== 'number'
	)
		throw new Error(
			`Capture ${name} has invalid scope position metadata; recapture this state.`,
		)
	return { x: raw.x, y: raw.y }
}

/** Load a stored capture and verify its metadata still matches the PNG. */
export async function loadCapture(name: string): Promise<PixelCapture> {
	const slug = captureName(name)
	const dir = captureDir()
	const png = await readFile(join(dir, `${slug}.png`))
	if (png.length > MAX_IMAGE_BYTES)
		throw new Error(`Capture ${slug} exceeds the 24 MB limit.`)
	const size = pngDimensions(png)
	const raw: unknown = JSON.parse(
		await readFile(join(dir, `${slug}.json`), 'utf8'),
	)
	if (
		!raw ||
		typeof raw !== 'object' ||
		!('url' in raw) ||
		typeof raw.url !== 'string' ||
		!('selector' in raw) ||
		(raw.selector !== null && typeof raw.selector !== 'string') ||
		!('viewport' in raw) ||
		!('position' in raw) ||
		!('width' in raw) ||
		raw.width !== size.width ||
		!('height' in raw) ||
		raw.height !== size.height
	)
		throw new Error(
			`Capture metadata does not match ${slug}.png; recapture this state.`,
		)
	return {
		png,
		url: raw.url,
		selector: raw.selector,
		viewport: viewportOf(raw.viewport, slug),
		position: positionOf(raw.position, slug),
		...size,
	}
}
