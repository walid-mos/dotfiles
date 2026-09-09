/** Thumbnail strip above the prompt: framed previews matched to [img:N] aliases. */

import { basename } from 'node:path'

import { getCapabilities, Image } from '@earendil-works/pi-tui'

import type { Theme } from '@earendil-works/pi-coding-agent'
import type { PromptCapture } from './image-paths.ts'

const IMAGE_COLUMNS = 10
/** Image columns plus the two rails. */
const RAIL_COLUMNS = 2
const TILE_COLUMNS = IMAGE_COLUMNS + RAIL_COLUMNS
/** One space separates neighbouring tiles. */
const TILE_SEPARATOR = ' '
/** Tile plus the separator. */
const TILE_PITCH = TILE_COLUMNS + TILE_SEPARATOR.length
const GUTTER = 2
/** Left and right gutters around the strip. */
const STRIP_PADDING = GUTTER + GUTTER
const MAX_PREVIEW_ROWS = 6

/**
 * Render the strip for the captured images. Falls back to a compact alias
 * list when the terminal cannot render images or the viewport is narrower
 * than a single tile.
 */
export function renderAttachmentStrip(
	captures: readonly PromptCapture[],
	scrollOffset: number,
	width: number,
	theme: Theme,
): string[] {
	if (!captures.length || width <= 0) return []
	const visible = visibleWindow(captures, scrollOffset, width)
	if (!visible) return [renderAliasList(captures, width, theme)]

	const tiles = visible.items.map(capture => buildTile(capture, theme))
	const line = (pick: (tile: Tile) => string): string =>
		tiles.map(tile => `${pick(tile)}${TILE_SEPARATOR}`).join('')
	const rowCount = Math.max(...tiles.map(tile => tile.rows.length))
	const previewRows = Array.from({ length: rowCount }, (_, row) =>
		indent(line(tile => tile.rows[row] ?? tile.blankRow)),
	)
	const labels = tiles
		.map(tile => `${tile.aliasLabel}${TILE_SEPARATOR}`)
		.join('')
	const moreBefore = visible.start > 0 ? '← ' : '  '
	const end = visible.start + visible.items.length
	const moreAfter = end < captures.length ? '→' : ''
	const labelRow =
		theme.fg('dim', moreBefore) +
		theme.fg('accent', theme.bold(labels)) +
		theme.fg('dim', moreAfter)
	return [
		indent(line(tile => tile.edgeTop)),
		...previewRows,
		indent(line(tile => tile.edgeBottom)),
		labelRow,
	]
}

type Tile = {
	edgeTop: string
	edgeBottom: string
	/** Frame rows for this preview's rendered image lines. */
	rows: readonly string[]
	/** Blank frame row for previews shorter than the tallest one. */
	blankRow: string
	aliasLabel: string
}

function buildTile(capture: PromptCapture, theme: Theme): Tile {
	const rail = (text: string): string => theme.fg('borderMuted', text)
	const railTop = rail(`╭${'─'.repeat(IMAGE_COLUMNS)}╮`)
	const railBottom = rail(`╰${'─'.repeat(IMAGE_COLUMNS)}╯`)
	const frame = (content: string): string =>
		`${rail('│')}${content}${' '.repeat(IMAGE_COLUMNS)}${rail('│')}`
	return {
		edgeTop: railTop,
		rows: renderPreview(capture, theme).map(frame),
		blankRow: frame(''),
		edgeBottom: railBottom,
		aliasLabel: centered(capture.alias, TILE_COLUMNS),
	}
}

/** Render one capture framed to fit within a single tile's columns. */
function renderPreview(
	capture: PromptCapture,
	theme: Theme,
): readonly string[] {
	return new Image(
		capture.data,
		capture.mimeType,
		{ fallbackColor: text => theme.fg('muted', text) },
		{
			filename: basename(capture.filePath),
			imageId: capture.imageId,
			maxWidthCells: IMAGE_COLUMNS,
			maxHeightCells: MAX_PREVIEW_ROWS,
		},
	).render(TILE_COLUMNS)
}

/**
 * The captures visible at `scrollOffset` for this viewport, or undefined when
 * the strip falls back to the alias list (no image protocol / narrow width).
 */
function visibleWindow(
	captures: readonly PromptCapture[],
	scrollOffset: number,
	width: number,
): { items: readonly PromptCapture[]; start: number } | undefined {
	if (!getCapabilities().images || width < STRIP_PADDING + TILE_PITCH)
		return undefined
	const capacity = Math.max(
		1,
		Math.floor((width - STRIP_PADDING) / TILE_PITCH),
	)
	const start = Math.min(
		scrollOffset,
		Math.max(0, captures.length - capacity),
	)
	return { items: captures.slice(start, start + capacity), start }
}

function renderAliasList(
	captures: readonly PromptCapture[],
	width: number,
	theme: Theme,
): string {
	const text = `images ${captures.map(capture => capture.alias).join(' ')}`
	return theme.fg('dim', text.slice(0, Math.max(0, width)))
}

function centered(text: string, width: number): string {
	const padding = Math.max(0, width - text.length)
	const left = Math.floor(padding / CENTERING_SIDES)
	return `${' '.repeat(left)}${text}${' '.repeat(padding - left)}`
}

/** Centering splits the remaining padding evenly between two sides. */
const CENTERING_SIDES = 2

function indent(line: string): string {
	return `${' '.repeat(GUTTER)}${line}`
}
