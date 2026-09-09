/** Thumbnail strip above the prompt: framed previews matched to [img:N] aliases. */

import { basename } from 'node:path'

import {
	getCapabilities,
	getCellDimensions,
	Image,
} from '@earendil-works/pi-tui'

import { scaledPreviewSize } from './image-preview.ts'

import type { Theme } from '@earendil-works/pi-coding-agent'
import type { PromptCapture } from './image-paths.ts'
import type { ImageBox } from './image-preview.ts'
import type { PreviewSource } from './preview-service.ts'

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
/** Centering splits the remaining padding evenly between two sides. */
const CENTERING_SIDES = 2

/** The preview pixels warm tiles render: 2x hidpi of a 10x6 cell tile. */
export const TILE_PREVIEW_BOX: ImageBox = { widthPx: 240, heightPx: 144 }

/**
 * Render the strip for the captured images. Falls back to a compact alias
 * list when the terminal cannot render images or the viewport is narrower
 * than a single tile. Every tile's frame wraps just its own capture, and all
 * tiles share the bottom row: shorter captures leave clean space above, so
 * no tile draws an empty framed rectangle. Cold captures show the filename
 * on their last row and are (once) requested from `previews`.
 */
export function renderAttachmentStrip(strip: StripFrame): string[] {
	const { captures, scrollOffset, width, theme, previews } = strip
	if (!captures.length || width <= 0) return []
	const visible = visibleWindow(captures, scrollOffset, width)
	if (!visible) return [renderAliasList(captures, width, theme)]

	const tiles = visible.items.map(capture =>
		buildTile(capture, previews, theme),
	)
	const line = (pick: (tile: Tile) => string): string =>
		tiles.map(tile => `${pick(tile)}${TILE_SEPARATOR}`).join('')
	const rowCount = Math.max(...tiles.map(tile => tile.rows.length))
	// Bottom-aligned strip: tiles shorter than the tallest sit higher, their
	// gap rows being plain spaces (no rails) so no empty frame ever shows.
	const alignedRow = (tile: Tile, row: number): string => {
		const inside = row - (rowCount - tile.rows.length)
		return inside >= 0
			? (tile.rows[inside] ?? tile.blankRow)
			: tile.blankRow
	}
	const previewRows = Array.from({ length: rowCount }, (_, row) =>
		indent(line(tile => alignedRow(tile, row))),
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
	return [...previewRows, indent(labelRow)]
}

/** Everything one strip render needs, at its editor-width pixels. */
export type StripFrame = {
	readonly captures: readonly PromptCapture[]
	readonly scrollOffset: number
	readonly width: number
	readonly theme: Theme
	readonly previews: PreviewSource
}

/** One bottom-aligned tile: its own rows, sized to just this capture. */
type Tile = {
	/** Warm: top rail + framed image rows + bottom rail. Pending: name last. */
	rows: readonly string[]
	/** Tile-width blank without rails, for gaps above shorter tiles. */
	blankRow: string
	aliasLabel: string
}

function buildTile(
	capture: PromptCapture,
	previews: PreviewSource,
	theme: Theme,
): Tile {
	const rail = (text: string): string => theme.fg('borderMuted', text)
	const railTop = rail(`╭${'─'.repeat(IMAGE_COLUMNS)}╮`)
	const railBottom = rail(`╰${'─'.repeat(IMAGE_COLUMNS)}╯`)
	const frame = (content: string): string =>
		`${rail('│')}${content}${' '.repeat(IMAGE_COLUMNS)}${rail('│')}`
	const warm = previews.peek(capture)
	if (!warm) previews.request(capture)
	const rows = warm
		? renderPreview(capture, warm, theme).map(frame)
		: renderPending(capture, theme)
	return {
		rows: [railTop, ...rows, railBottom],
		blankRow: BLANK_TILE_ROW,
		aliasLabel: centered(capture.alias, TILE_COLUMNS),
	}
}

/** Render one warm capture framed to fit within a single tile's columns. */
function renderPreview(
	capture: PromptCapture,
	preview: string,
	theme: Theme,
): readonly string[] {
	return new Image(
		preview,
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

/** Until the background compute settles: gap rows, then the filename last. */
function renderPending(
	capture: PromptCapture,
	theme: Theme,
): readonly string[] {
	// Same length as the warm image rows: the rails frame both to one height.
	const rows = Array.from<string>({ length: warmTileRows(capture) }).fill(
		BLANK_TILE_ROW,
	)
	rows[rows.length - 1] = theme.fg(
		'dim',
		centered(truncateFilename(basename(capture.filePath)), IMAGE_COLUMNS),
	)
	return rows
}

/** A tile's width of plain spacing, wherever short tiles need filler. */
const BLANK_TILE_ROW = ' '.repeat(TILE_COLUMNS)

/**
 * The row count the warm tile will occupy, so the placeholder occupies the
 * same strip height (plus the two rails both states add) and the strip never
 * reflows when the thumbnail lands. Mirrors pi-tui's image row math; its
 * `calculateImageCellSize` stays private, so the formula lives here, pinned
 * by the strip parity test against the real renderer.
 */
function warmTileRows(capture: PromptCapture): number {
	const preview = scaledPreviewSize(capture.data, TILE_PREVIEW_BOX)
	if (preview.widthPx <= 0 || preview.heightPx <= 0) return MAX_PREVIEW_ROWS
	const cells = getCellDimensions()
	const widthScale = (IMAGE_COLUMNS * cells.widthPx) / preview.widthPx
	const heightScale = (MAX_PREVIEW_ROWS * cells.heightPx) / preview.heightPx
	const scale = Math.min(widthScale, heightScale)
	const rows = Math.ceil((preview.heightPx * scale) / cells.heightPx)
	return Math.max(1, Math.min(MAX_PREVIEW_ROWS, rows))
}

/** Tile-clip filenames; previews arrive before anyone needs the rest. */
function truncateFilename(name: string): string {
	return name.length <= IMAGE_COLUMNS
		? name
		: `${name.slice(0, IMAGE_COLUMNS - 1)}…`
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

function indent(line: string): string {
	return `${' '.repeat(GUTTER)}${line}`
}
