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

interface FramedBlock {
	width: number
	title: string
	lines: readonly string[]
	footer: string
}

export function frameContentWidth(width: number): number {
	return Math.max(0, columnWidth(width) - ROW_CHROME)
}

function frameEdge(
	width: number,
	label: string,
	edge: 'top' | 'bottom',
): string {
	if (width < EDGE_CHROME) return uiTheme.fg('border', FILL.repeat(width))
	const content = truncateTerminalLine(label, width - EDGE_CHROME, '…')
	const fill = FILL.repeat(width - EDGE_CHROME - terminalLineWidth(content))
	const [left, right] = edge === 'top' ? ['╭', '╮'] : ['╰', '╯']
	return `${uiTheme.fg('border', `${left}${FILL}${INSET}`)}${content}${INSET}${uiTheme.fg('border', `${fill}${right}`)}`
}

function frameRow(line: string, width: number): string {
	if (width < ROW_CHROME) return uiTheme.fg('border', RAIL.repeat(width))
	const contentWidth = frameContentWidth(width)
	const content = truncateTerminalLine(line, contentWidth, '…')
	const padding = ' '.repeat(contentWidth - terminalLineWidth(content))
	const rail = uiTheme.fg('border', RAIL)
	return `${rail}${INSET}${content}${padding}${INSET}${rail}`
}

export function framedBlock(block: FramedBlock): string[] {
	const width = columnWidth(block.width)
	if (!width) return []
	return [
		frameEdge(width, block.title, 'top'),
		...block.lines.map(line => frameRow(line, width)),
		frameEdge(width, block.footer, 'bottom'),
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
