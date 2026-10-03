import { PI_PALETTE as LATTE } from '#lib/ui/design-system/palette.ts'
import {
	blendHex,
	foregroundHex as fgHex,
} from '#lib/ui/design-system/terminal-color.ts'

import { PERCENT_SCALE } from './gauge.ts'
// Context gauge segment: ONE meter bar over the model window. The usage fill
// left-paints cells by its thresholds; the Context Budget paints a band of at
// most 4 cells pinned to the bar's right end: a bright wall cell at the wall
// and a fade to the horizon - solid cells blending the wall hue toward the
// base as the bar ends - reserved territory, in hues the usage ramp never
// wears. Pure, no IO.
import { fmtTokens, thinSep } from './text.ts'
import { BAR_EMPTY, BAR_FULL, BAR_WIDTH, ICONS } from './theme.ts'

import type { ContextUsage } from '@earendil-works/pi-coding-agent'
import type { FooterBudget } from './budget.ts'

/** Context usage tint thresholds (% of the core model window). */
const CONTEXT_COMFORT_PCT = 50
const CONTEXT_WARNING_PCT = 80

/** The budget band wears one identity hue - never gray, green, yellow or red. */
const BUDGET_COLOR = LATTE.mauve

type ContextPercent = number | null

function asFinitePercent(contextPercent: ContextPercent): ContextPercent {
	if (contextPercent === null || !Number.isFinite(contextPercent)) return null
	return contextPercent
}

function contextColor(percent: number): string {
	if (percent < CONTEXT_COMFORT_PCT) return LATTE.green
	if (!(percent < CONTEXT_WARNING_PCT)) return LATTE.red
	return LATTE.peach
}

/**
 * A share of the window maps to meter cells on a sqrt-warped axis: small
 * shares keep latitude (the low band where budgets and early usage live),
 * large shares compress. Monotonic 0→0 and 1→BAR_WIDTH, and the usage fill
 * and the budget wall share the same axis so the empty gap between them
 * stays meaningful.
 */
function gaugeCells(share: number): number {
	const ratio = Math.max(0, Math.min(1, share))
	return Math.round(Math.sqrt(ratio) * BAR_WIDTH)
}

const EMPTY_COLOR = LATTE.surface1

/**
 * The band never floods the gauge: a small budget share pins the band to
 * the bar's right end and bounds it at this many cells, so room for the
 * usage fill, the wall and empty space always stays visible. The wall
 * stays at its own warped cell whenever it sits past this bound; nearer
 * the start, the band simply holds at the bound.
 */
const BAND_MAX_CELLS = 4

/**
 * The merged meter: usage fill from the left; the budget wall sits at the
 * budget's proportional cell as one bright cell and the band runs from the
 * wall to the bar's end as fade-to-horizon cells, solids blending the
 * budget hue toward the base as the bar ends, bounded at
 * BAND_MAX_CELLS wide. The band always wins where a usage fill crosses
 * it, so the wall stays legible; without a budget (or with one covering
 * the whole window) this is the plain gauge.
 */
const BAND_FADE_START_RATIO = 0.2
const BAND_FADE_END_RATIO = 0.6

function bandFadeRatio(offset: number, bandWidth: number): number {
	const span = Math.max(1, bandWidth - 1)
	const step = offset / span
	return (
		BAND_FADE_START_RATIO +
		(BAND_FADE_END_RATIO - BAND_FADE_START_RATIO) * step
	)
}
function bandCellColor(cell: number, bandStart: number): string {
	if (cell === bandStart) return BUDGET_COLOR
	return blendHex(
		BUDGET_COLOR,
		LATTE.base,
		bandFadeRatio(cell - bandStart, BAR_WIDTH - bandStart),
	)
}

function meterBar(
	usagePercent: number,
	usageColor: string,
	budget: FooterBudget | undefined,
): string {
	const fillCells = gaugeCells(usagePercent / PERCENT_SCALE)
	const wallCell = budget
		? gaugeCells(budget.limit / budget.window)
		: BAR_WIDTH
	if (wallCell >= BAR_WIDTH) {
		return `${fgHex(usageColor, BAR_FULL.repeat(fillCells))}${fgHex(EMPTY_COLOR, BAR_EMPTY.repeat(BAR_WIDTH - fillCells))}`
	}
	const bandStart = Math.max(wallCell, BAR_WIDTH - BAND_MAX_CELLS)
	const runs: string[] = []
	let runColor = ''
	let runGlyph = ''
	let runCells = 0
	for (let cell = 0; cell < BAR_WIDTH; cell += 1) {
		// The budget wall wins: a usage fill crossing into the band stays tinted
		const inBand = cell >= bandStart
		const inFill = cell < fillCells
		let color: string
		let glyph: string
		if (inBand) {
			// The wall keeps the bright identity hue; cells beyond it fade
			// toward the base as the bar ends - reserved territory dissolving
			// ahead, in hues the usage ramp never wears.
			color = bandCellColor(cell, bandStart)
			glyph = BAR_FULL
		} else if (inFill) {
			color = usageColor
			glyph = BAR_FULL
		} else {
			color = EMPTY_COLOR
			glyph = BAR_EMPTY
		}
		if (color === runColor && glyph === runGlyph && runCells > 0) {
			runCells += 1
			continue
		}
		if (runCells > 0) runs.push(fgHex(runColor, runGlyph.repeat(runCells)))
		runColor = color
		runGlyph = glyph
		runCells = 1
	}
	if (runCells > 0) runs.push(fgHex(runColor, runGlyph.repeat(runCells)))
	return runs.join('')
}

function contextExactTokens(
	tokens: number | null,
	contextWindow: number | null,
	willShowExactTokens: boolean,
): string {
	if (!willShowExactTokens) return ''
	if (tokens === null || contextWindow === null) return ''
	return ` ${fgHex(LATTE.subtext0, `${fmtTokens(tokens)}/${fmtTokens(contextWindow)}`)}`
}

/**
 * The limit token wears the band's hue, not the lane gray, so the number
 * ties to the band on the bar. House quiet-ink pattern, mixed toward the
 * base at its own surface tone (like ui/hud-telemetry's quiet tokens).
 */
const BUDGET_LIMIT_QUIET_RATIO = 0.45

const BUDGET_LIMIT_COLOR = blendHex(
	BUDGET_COLOR,
	LATTE.base,
	BUDGET_LIMIT_QUIET_RATIO,
)

/** The limit stays readable as one quiet token in the full lane, band-hued. */
function budgetLimitTokens(
	budget: FooterBudget | undefined,
	willShowExactTokens: boolean,
): string {
	if (!budget || !willShowExactTokens) return ''
	return ` ${thinSep()} ${fgHex(BUDGET_LIMIT_COLOR, fmtTokens(budget.limit))}`
}

export function contextGroup(
	usage: ContextUsage,
	willShowExactTokens: boolean,
	budget: FooterBudget | undefined,
): string {
	const percent = asFinitePercent(usage.percent)
	if (percent === null) return ''
	const color = contextColor(percent)
	const bar = meterBar(percent, color, budget)
	const exact = contextExactTokens(
		usage.tokens,
		usage.contextWindow,
		willShowExactTokens,
	)
	const limit = budgetLimitTokens(budget, willShowExactTokens)
	return `${fgHex(LATTE.subtext0, ICONS.context)} ${bar} ${fgHex(color, `${Math.round(percent)}%`)}${exact}${limit}`
}
