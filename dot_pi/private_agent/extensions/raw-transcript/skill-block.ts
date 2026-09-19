/** Skill invocation callouts: one rose band per card, deliberately distinct from
 * prompts, tool rows and mutation panels. A pink spine anchors the top-left corner
 * and casts the light: the rose is painted per column under the text and per row,
 * easing monotonically to the background on both axes, so the band has no flat
 * block, no seam and no hard end. Static paint: no timer, no IO. */
import { backgroundHex } from '../ui/design-system/terminal-color.ts'
import { skillBandHex, uiTheme } from '../ui/design-system/theme.ts'
import { ResponseMarkdown } from '../ui/response-markdown.ts'
import {
	columnWidth,
	sliceTerminalColumns,
	terminalLineWidth,
	wrapTerminalLine,
} from '../ui/terminal-text.ts'

import type { Component, MarkdownTheme } from '@earendil-works/pi-tui'

const GLYPH = '✦'
/** Spine bar and its breathing gap: the band's light source. */
const SPINE_BAR = '▎'
const SPINE_GAP = ' '
const SPINE_COLUMNS = 2
/** Below this width the callout sheds its spine rather than overrun. */
const MIN_SPINE_COLUMNS = 5
const MIN_HINT_COLUMNS = 24
/** Rose opacity at the top row's spine, easing out on both axes. */
const GLOW_RATIO = 0.12
const GLOW_EASE = 1.6
const GLOW_COLUMNS = 110
const GLOW_STEP_COLUMNS = 2
/** Rows the light takes to fall from the spine row to nothing. */
const GLOW_ROWS = 18
/** A step samples its opacity at the midpoint, which keeps the ramp monotone. */
const STEP_MIDPOINT = 0.5

/** Parsed skill block fields the card displays. */
export interface SkillSource {
	name: string
	location: string
	content: string
}

interface RenderedLines {
	width: number
	rendersExpanded: boolean
	lines: string[]
}

/**
 * Paints one full-width band row as a single continuous falloff: `peakShare` of
 * the peak, brightest at the spine, easing out over 2-column steps. Past the
 * glow the row stays unpainted, so the transcript background shows through.
 */
function bandRow(row: string, columns: number, peakShare: number): string {
	const glowColumns = Math.min(columns, GLOW_COLUMNS)
	const peak = GLOW_RATIO * peakShare
	let painted = ''
	let column = 0
	while (column < columns) {
		const step = Math.min(GLOW_STEP_COLUMNS, columns - column)
		const slice = sliceTerminalColumns(row, column, step)
		const width = Math.max(1, terminalLineWidth(slice))
		const progress = (column + width * STEP_MIDPOINT) / glowColumns
		const ratio = peak * (1 - progress) ** GLOW_EASE
		painted += ratio > 0 ? backgroundHex(skillBandHex(ratio), slice) : slice
		column += width
	}
	return painted
}

/** Share of the glow peak a row keeps: the light falls off down the card. */
function rowShare(rowIndex: number): number {
	return Math.max(0, 1 - rowIndex / GLOW_ROWS)
}

/** Collapsed identity or expanded identity + source location + house Markdown. */
export class SkillBlock implements Component {
	private readonly name: string
	private readonly location: string
	private readonly toggleKey: string
	private readonly markdown: ResponseMarkdown | undefined
	private isExpanded = false
	private cached: RenderedLines | undefined
	private band: RenderedLines | undefined

	constructor(
		source: SkillSource,
		markdownTheme: MarkdownTheme | undefined,
		toggleKey: string,
	) {
		this.name = source.name
		this.location = source.location
		this.toggleKey = toggleKey
		this.markdown =
			source.content && markdownTheme
				? new ResponseMarkdown(source.content, markdownTheme, {
						inset: 0,
						tone: 'text',
					})
				: undefined
	}

	setExpanded(isExpanded: boolean): void {
		this.isExpanded = isExpanded
	}

	invalidate(): void {
		this.cached = undefined
		this.band = undefined
		this.markdown?.invalidate()
	}

	/** Full-viewport band, already painted: the surface returns it as-is. */
	renderBand(width: number): string[] {
		const columns = columnWidth(width)
		if (!columns) return []
		if (
			this.band?.width === columns &&
			this.band.rendersExpanded === this.isExpanded
		)
			return this.band.lines
		const spine = columns >= MIN_SPINE_COLUMNS ? SPINE_COLUMNS : 0
		const content = Math.max(1, columns - spine)
		const mark = spine ? uiTheme.fg('skill', SPINE_BAR) + SPINE_GAP : ''
		const lines = ['', ...this.render(content), ''].map((line, index) => {
			const row = mark + line
			return bandRow(
				row + ' '.repeat(Math.max(0, columns - terminalLineWidth(row))),
				columns,
				rowShare(index),
			)
		})
		this.band = { width: columns, rendersExpanded: this.isExpanded, lines }
		return lines
	}

	render(width: number): string[] {
		const columns = columnWidth(width)
		if (!columns) return []
		if (
			this.cached?.width === columns &&
			this.cached.rendersExpanded === this.isExpanded
		)
			return this.cached.lines
		const lines = [
			...this.identity(columns),
			...(this.isExpanded ? this.expandedLines(columns) : []),
		]
		this.cached = {
			width: columns,
			rendersExpanded: this.isExpanded,
			lines,
		}
		return lines
	}

	private identity(columns: number): string[] {
		const brand = uiTheme.fg('skill', `${GLYPH} skill ·`)
		const name = this.name ? ` ${uiTheme.bold(this.name)}` : ''
		const hint =
			columns < MIN_HINT_COLUMNS
				? ''
				: `  ${uiTheme.fg('dim', `(click / ${this.toggleKey} to ${this.isExpanded ? 'fold' : 'expand'})`)}`
		return wrapTerminalLine(`${brand}${name}${hint}`, columns)
	}

	private expandedLines(columns: number): string[] {
		const location = this.location
			? wrapTerminalLine(uiTheme.fg('dim', this.location), columns)
			: []
		const body = this.markdown?.render(columns) ?? []
		if (!location.length || !body.length) return [...location, ...body]
		return [...location, '', ...body]
	}
}
