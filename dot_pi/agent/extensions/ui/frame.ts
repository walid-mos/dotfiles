/** House frame geometry. Callers supply content, never padding or width metrics. */
import { INSET } from './align.ts'
import { uiTheme } from './design-system/theme.ts'
import {
	columnWidth,
	terminalLineWidth,
	truncateTerminalLine,
} from './terminal-text.ts'

const RAIL = '│'
const FILL = '─'
const ROW_CHROME = `${RAIL}${INSET}${INSET}${RAIL}`.length
const EDGE_CHROME = `╭${FILL}${INSET}${INSET}╮`.length
const FRAME_CORNERS = {
	rounded: { top: ['╭', '╮'], bottom: ['╰', '╯'] },
	square: { top: ['┌', '┐'], bottom: ['└', '┘'] },
} as const

interface FramedBlock {
	width: number
	title: string
	lines: readonly string[]
	footer: string
	border?: (stroke: string) => string
	corners?: keyof typeof FRAME_CORNERS
}

export function frameContentWidth(width: number): number {
	return Math.max(0, columnWidth(width) - ROW_CHROME)
}

function frameEdge(
	width: number,
	label: string,
	corners: readonly [string, string],
	border: (stroke: string) => string,
): string {
	if (width < EDGE_CHROME) return border(FILL.repeat(width))
	const [left, right] = corners
	if (!label)
		return border(left + FILL.repeat(width - (left + right).length) + right)
	const content = truncateTerminalLine(label, width - EDGE_CHROME, '…')
	const fill = FILL.repeat(width - EDGE_CHROME - terminalLineWidth(content))
	return `${border(`${left}${FILL}${INSET}`)}${content}${INSET}${border(`${fill}${right}`)}`
}

function frameRow(
	line: string,
	width: number,
	border: (stroke: string) => string,
): string {
	if (width < ROW_CHROME) return border(RAIL.repeat(width))
	const contentWidth = frameContentWidth(width)
	const content = truncateTerminalLine(line, contentWidth, '…')
	const padding = ' '.repeat(contentWidth - terminalLineWidth(content))
	const rail = border(RAIL)
	return `${rail}${INSET}${content}${padding}${INSET}${rail}`
}

export function framedBlock(block: FramedBlock): string[] {
	const width = columnWidth(block.width)
	if (!width) return []
	const border =
		block.border ?? ((stroke: string) => uiTheme.fg('border', stroke))
	const corners = FRAME_CORNERS[block.corners ?? 'rounded']
	return [
		frameEdge(width, block.title, corners.top, border),
		...block.lines.map(line => frameRow(line, width, border)),
		frameEdge(width, block.footer, corners.bottom, border),
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
