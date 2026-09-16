/** House frame geometry. Callers supply content and spacing, never width metrics. */
import { INSET } from './align.ts'
import { uiTheme } from './design-system/theme.ts'
import {
	columnWidth,
	terminalLineWidth,
	truncateTerminalLine,
} from './terminal-text.ts'

const RAIL = '│'
const FILL = '─'
const DEFAULT_INSETS = {
	row: INSET.length,
	title: INSET.length,
	right: INSET.length,
}
const FRAME_CORNERS = {
	rounded: { top: ['╭', '╮'], bottom: ['╰', '╯'] },
	square: { top: ['┌', '┐'], bottom: ['└', '┘'] },
} as const

/** Columns between a frame stroke and its content. `row` and `title` are
 * independent so a caller can put both on the same column as an activity row. */
export interface FrameInsets {
	row?: number
	title?: number
	right?: number
}

/** A line appended verbatim: terminal image payloads carry cursor movement and
 * must never be clipped or padded. */
export interface FrameRawLine {
	raw: string
}

type FrameLine = string | FrameRawLine

interface FramedBlock {
	width: number
	title: string
	lines: readonly FrameLine[]
	footer: string
	insets?: FrameInsets
	border?: (stroke: string) => string
	corners?: keyof typeof FRAME_CORNERS
}

function resolvedInsets(insets?: FrameInsets): Required<FrameInsets> {
	return {
		row: Math.max(0, Math.floor(insets?.row ?? DEFAULT_INSETS.row)),
		title: Math.max(0, Math.floor(insets?.title ?? DEFAULT_INSETS.title)),
		right: Math.max(0, Math.floor(insets?.right ?? DEFAULT_INSETS.right)),
	}
}

interface FrameStroke {
	border: (stroke: string) => string
	insets: Required<FrameInsets>
}

function rowChrome(insets: Required<FrameInsets>): number {
	return 1 + insets.row + insets.right + 1
}

export function frameContentWidth(width: number, insets?: FrameInsets): number {
	return Math.max(0, columnWidth(width) - rowChrome(resolvedInsets(insets)))
}

function frameEdge(
	width: number,
	label: string,
	corners: readonly [string, string],
	stroke: FrameStroke,
): string {
	const { border, insets } = stroke
	const chrome = 1 + 1 + insets.title + insets.right + 1
	const [left, right] = corners
	if (!label)
		return border(left + FILL.repeat(width - (left + right).length) + right)
	if (width < chrome) return border(FILL.repeat(width))
	const content = truncateTerminalLine(label, width - chrome, '…')
	const fill = FILL.repeat(width - chrome - terminalLineWidth(content))
	return `${border(`${left}${FILL}${' '.repeat(insets.title)}`)}${content}${' '.repeat(insets.right)}${border(`${fill}${right}`)}`
}

function frameRow(line: string, width: number, stroke: FrameStroke): string {
	const { border, insets } = stroke
	if (width < rowChrome(insets)) return border(RAIL.repeat(width))
	const contentWidth = width - rowChrome(insets)
	const content = truncateTerminalLine(line, contentWidth, '…')
	const padding = ' '.repeat(contentWidth - terminalLineWidth(content))
	return `${border(RAIL)}${' '.repeat(insets.row)}${content}${padding}${' '.repeat(insets.right)}${border(RAIL)}`
}

function frameLine(
	line: FrameLine,
	width: number,
	stroke: FrameStroke,
): string {
	if (typeof line === 'string') return frameRow(line, width, stroke)
	const { border, insets } = stroke
	// A blank payload line is still a framed row: the image paints over it later.
	if (!line.raw) return frameRow('', width, stroke)
	if (width <= 1 + insets.row) return border(RAIL.repeat(width))
	return `${border(RAIL)}${' '.repeat(insets.row)}${line.raw}`
}

export function framedBlock(block: FramedBlock): string[] {
	const width = columnWidth(block.width)
	if (!width) return []
	const border =
		block.border ?? ((stroke: string) => uiTheme.fg('border', stroke))
	const insets = resolvedInsets(block.insets)
	const corners = FRAME_CORNERS[block.corners ?? 'rounded']
	const stroke: FrameStroke = { border, insets }
	return [
		frameEdge(width, block.title, corners.top, stroke),
		...block.lines.map(line => frameLine(line, width, stroke)),
		frameEdge(width, block.footer, corners.bottom, stroke),
	]
}

/** Padded selection band; non-breaking padding survives Pi's trailing trim. */
export function highlightRow(line: string, width: number): string {
	const budget = columnWidth(width)
	const content = truncateTerminalLine(line, budget, '…')
	const padding = '\u00a0'.repeat(budget - terminalLineWidth(content))
	return uiTheme.bg('selectedBg', content + padding)
}

export function blockTitle(label: string, meta?: string): string {
	const title = uiTheme.fg('accent', uiTheme.bold(label))
	return meta ? `${title}${uiTheme.fg('dim', ` · ${meta}`)}` : title
}
