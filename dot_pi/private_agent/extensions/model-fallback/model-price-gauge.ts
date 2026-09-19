/**
 * model-fallback - the price gauge: where a model sits on the log scale.
 *
 * Pure geometry and ink over a `ModelPrice` reading (`model-price.ts`): the
 * track is a house-hue gradient, the dots are the cursor row and the session
 * model, and the formula beside the track names the exact rates that were
 * blended - so a reading with a rate its source never published can be checked
 * by hand instead of guessed. Nothing here touches IO.
 */

import { blendHex, foregroundHex } from '../ui/design-system/terminal-color.ts'
import { UI_COLOR } from '../ui/design-system/theme.ts'

import { PRICE_UNIT } from './model-price.ts'

import type { ModelPrice } from './model-price.ts'

const GAUGE_MIN_PER_MILLION = 0.01
const GAUGE_MAX_PER_MILLION = 50
const GAUGE_MIDPOINT_RATIO = 0.5
/** Two stops: cheap to amber, amber to expensive. */
const GAUGE_STOP_SPAN = 2
const GAUGE_TRACK_CELL = '─'

export interface GaugeDot {
	/** 0..1 along the track. */
	ratio: number
	glyph: string
	ink: string
}

/** The three rate columns the gauge can blend, in display order. */
type GaugeTermName = 'input' | 'cached' | 'output'

interface GaugeTerm {
	name: GaugeTermName
	rate: number
}

/** The rates the gauge blends; a rate the source did not publish is not a zero. */
function gaugeTerms(price: ModelPrice): GaugeTerm[] {
	const columns: [GaugeTermName, number | null][] = [
		['input', price.input],
		['cached', price.cachedInput],
		['output', price.output],
	]
	const terms: GaugeTerm[] = []
	for (const [name, rate] of columns) {
		if (rate !== null) terms.push({ name, rate })
	}
	return terms
}

/** The single number the gauge plots; null when the row has no rate at all. */
export function blendedRate(price: ModelPrice): number | null {
	const terms = gaugeTerms(price)
	if (!terms.length) return null
	return terms.reduce((sum, term) => sum + term.rate, 0) / terms.length
}

export function gaugeRatio(price: ModelPrice): number | null {
	const rate = blendedRate(price)
	if (rate === null) return null
	// A $0 blend is the free end of the track, not an off-scale reading.
	if (rate <= 0) return 0
	const span =
		Math.log10(GAUGE_MAX_PER_MILLION) - Math.log10(GAUGE_MIN_PER_MILLION)
	const offset = Math.log10(rate) - Math.log10(GAUGE_MIN_PER_MILLION)
	return Math.min(1, Math.max(0, offset / span))
}

/** Cheap models read green, mid amber, expensive purple: house hues only. */
export function gaugeInk(ratio: number): string {
	const cheapStop = blendHex(
		UI_COLOR.success,
		UI_COLOR.warning,
		ratio * GAUGE_STOP_SPAN,
	)
	if (ratio < GAUGE_MIDPOINT_RATIO) return cheapStop
	return blendHex(
		UI_COLOR.warning,
		UI_COLOR.accent,
		(ratio - GAUGE_MIDPOINT_RATIO) * GAUGE_STOP_SPAN,
	)
}

/** The gradient track alone; markers are painted over it by `gaugeLine`. */
export function gaugeTrack(columns: number): string[] {
	const cells: string[] = []
	for (let column = 0; column < columns; column += 1) {
		const ratio = columns <= 1 ? 0 : column / (columns - 1)
		cells.push(foregroundHex(gaugeInk(ratio), GAUGE_TRACK_CELL))
	}
	return cells
}

/** The track with its model markers: later dots win a shared column. */
export function gaugeLine(columns: number, dots: readonly GaugeDot[]): string {
	if (columns <= 0) return ''
	const cells = gaugeTrack(columns)
	for (const dot of dots) {
		const column = Math.round(dot.ratio * (columns - 1))
		cells[column] = foregroundHex(dot.ink, dot.glyph)
	}
	return cells.join('')
}

const GAUGE_SCALE = `log scale $${GAUGE_MIN_PER_MILLION} - $${GAUGE_MAX_PER_MILLION}`
const DEFAULT_GAUGE_TERMS: GaugeTermName[] = ['input', 'cached', 'output']

/** The blend the gauge plots for this reading, printed beside the track. */
export function gaugeFormula(price: ModelPrice): string {
	const terms = gaugeTerms(price).map(term => term.name)
	const names = terms.length ? terms : DEFAULT_GAUGE_TERMS
	return `blend (${names.join(' + ')}) / ${names.length} ${PRICE_UNIT}, ${GAUGE_SCALE}`
}
