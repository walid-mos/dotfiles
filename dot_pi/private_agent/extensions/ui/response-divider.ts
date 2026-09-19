import { blendHex, foregroundHex } from './design-system/terminal-color.ts'
/** Centered response landmarks: quiet updates, accented final answers, symmetric edge fades. */
import { UI_COLOR, uiTheme } from './design-system/theme.ts'
import {
	columnWidth,
	terminalLineWidth,
	truncateTerminalLine,
} from './terminal-text.ts'

import type { Component } from '@earendil-works/pi-tui'

export type ResponseEmphasis = 'intermediate' | 'final'

const DIVIDERS = {
	intermediate: {
		fraction: 0.48,
		maximum: 44,
		ink: UI_COLOR.muted,
		strength: 0.65,
	},
	'intermediate-footer': {
		fraction: 0.3,
		maximum: 28,
		ink: UI_COLOR.muted,
		strength: 0.3,
	},
	final: { fraction: 0.88, maximum: 78, ink: UI_COLOR.accent, strength: 0.8 },
} as const
type DividerKind = keyof typeof DIVIDERS
const ANSWER_TITLE = 'Answer'
const ANSWER_ORNAMENT = '✦'
const TITLE_GAP = ' '
const HALVES = 2
const EDGE_STRENGTH = 0.04
const FADE_POWER = 2
const MIN_ORNAMENT_WIDTH = 18

function fadedWing(columns: number, emphasis: DividerKind): string[] {
	const { ink, strength } = DIVIDERS[emphasis]
	return Array.from({ length: columns }, (_unused, index) => {
		const progress = (index / Math.max(1, columns - 1)) ** FADE_POWER
		const opacity = EDGE_STRENGTH + (strength - EDGE_STRENGTH) * progress
		return foregroundHex(blendHex(UI_COLOR.base, ink, opacity), '─')
	})
}

function dividerLine(emphasis: DividerKind, columns: number): string {
	const design = DIVIDERS[emphasis]
	const title =
		columns >= MIN_ORNAMENT_WIDTH
			? `${ANSWER_ORNAMENT} ${ANSWER_TITLE}`
			: ANSWER_TITLE
	const label =
		emphasis === 'final' ? truncateTerminalLine(title, columns, '…') : ''
	const labelColumns = terminalLineWidth(label)
	const gaps = label && columns >= labelColumns + HALVES ? HALVES : 0
	const preferred = Math.floor(columns * design.fraction)
	const span = Math.min(
		columns,
		Math.max(labelColumns + gaps, Math.min(design.maximum, preferred)),
	)
	const wingColumns = Math.floor((span - labelColumns - gaps) / HALVES)
	const cells = fadedWing(wingColumns, emphasis)
	const left = cells.join('')
	// Reverse complete styled cells, never ANSI bytes.
	const right = cells.toReversed().join('')
	const gap = gaps ? TITLE_GAP : ''
	const center = label
		? gap + uiTheme.bold(uiTheme.fg('accent', label)) + gap
		: ''
	const line = left + center + right
	return (
		' '.repeat(Math.floor((columns - terminalLineWidth(line)) / HALVES)) +
		line
	)
}

export class ResponseDivider implements Component {
	private readonly emphasis: DividerKind
	private cached: { width: number; lines: string[] } | undefined

	constructor(emphasis: DividerKind) {
		this.emphasis = emphasis
	}

	render(width: number): string[] {
		const columns = columnWidth(width)
		if (this.cached?.width === columns) return this.cached.lines
		const lines = [dividerLine(this.emphasis, columns)]
		this.cached = { width: columns, lines }
		return lines
	}

	invalidate(): void {
		this.cached = undefined
	}
}
