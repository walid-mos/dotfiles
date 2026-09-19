/**
 * model-fallback - the price panel under the session list: the gauge with its
 * two dots, the three rate columns and the two disclosures under them.
 *
 * Pure layout over a `ModelPrice` reading: the gauge is dropped before the list
 * starves (a short terminal keeps the columns), and long text is clipped, never
 * wrapped, so the panel holds one shape at any width. Nothing here touches IO.
 */

import { UI_COLOR, uiTheme } from '../ui/design-system/theme.ts'
import { GLYPH } from '../ui/selection-marker.ts'
import { truncateTerminalLine } from '../ui/terminal-text.ts'

import {
	gaugeFormula,
	gaugeInk,
	gaugeLine,
	gaugeRatio,
} from './model-price-gauge.ts'
import { PRICE_UNIT, modelPrice, priceCells, priceNote } from './model-price.ts'

import type { CatalogRow } from './model-catalog.ts'
import type { PickerLine, PickerView } from './model-picker-view.ts'
import type { GaugeDot } from './model-price-gauge.ts'

const MIN_GAUGE_COLUMNS = 8
const MAX_GAUGE_COLUMNS = 56
const GAUGE_INSET = 8
const NARROW_WIDTH = 56
const ROW_LABEL_INSET = 2

export interface PriceBlockInput {
	view: PickerView
	/** The row the cursor is on, and the row the panel prices. */
	selected: CatalogRow | undefined
	width: number
	/** A short terminal sheds the gauge lines but keeps the columns. */
	isCompact: boolean
}

/** A model's marker on the track, or nothing when no source priced the row. */
function priceMarker(
	row: CatalogRow | undefined,
	view: PickerView,
): number | null {
	if (!row) return null
	return gaugeRatio(modelPrice(row.reference, row.model.cost, view.pricing))
}

/** Model markers on the track: solid for the cursor row, hollow for the session. */
function gaugeDots(
	selected: CatalogRow | undefined,
	current: CatalogRow | undefined,
	view: PickerView,
): GaugeDot[] {
	const dots: GaugeDot[] = []
	const currentRatio = priceMarker(current, view)
	if (currentRatio !== null)
		dots.push({
			ratio: currentRatio,
			glyph: GLYPH.radioOff,
			ink: UI_COLOR.muted,
		})
	const selectedRatio = priceMarker(selected, view)
	if (selectedRatio !== null)
		dots.push({
			ratio: selectedRatio,
			glyph: GLYPH.radioOn,
			ink: gaugeInk(selectedRatio),
		})
	return dots
}

export function priceBlock(input: PriceBlockInput): PickerLine[] {
	const { selected, view, width } = input
	if (!selected) return []
	const current = view.rows.find(row => row.isCurrent)
	const price = modelPrice(
		selected.reference,
		selected.model.cost,
		view.pricing,
	)
	const cells = priceCells(price)
	const lines: PickerLine[] = []
	if (width >= NARROW_WIDTH && !input.isCompact) {
		const columns = Math.max(
			MIN_GAUGE_COLUMNS,
			Math.min(MAX_GAUGE_COLUMNS, width - GAUGE_INSET),
		)
		lines.push({
			text: `  ${gaugeLine(columns, gaugeDots(selected, current, view))}`,
		})
	}
	const prices = `Input ${cells.input} · Cached input ${cells.cachedInput} · Output ${cells.output} ${PRICE_UNIT}`
	lines.push({
		text: `  ${truncateTerminalLine(prices, width - ROW_LABEL_INSET, '…')}`,
	})
	lines.push({
		text: `  ${truncateTerminalLine(priceNote(price, view.now), width - ROW_LABEL_INSET, '…')}`,
	})
	if (width >= NARROW_WIDTH && !input.isCompact) {
		const formula = `gauge · ${gaugeFormula(price)}`
		lines.push({
			text: `  ${uiTheme.fg('dim', truncateTerminalLine(formula, width - ROW_LABEL_INSET, '…'))}`,
		})
	}
	return lines
}
