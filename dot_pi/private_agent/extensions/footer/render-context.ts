import { PI_PALETTE as LATTE } from '../ui/design-system/palette.ts'
import { foregroundHex as fgHex } from '../ui/design-system/terminal-color.ts'

import { PERCENT_SCALE } from './gauge.ts'
// Context gauge segment: pi ContextUsage rendered as a meter bar with
// tint thresholds and optional exact token counts. Pure, no IO.
import { fmtTokens } from './text.ts'
import { BAR_EMPTY, BAR_FULL, BAR_WIDTH, ICONS } from './theme.ts'

import type { ContextUsage } from '@earendil-works/pi-coding-agent'

/** Context usage tint thresholds (% of the core model window). */
const CONTEXT_COMFORT_PCT = 50
const CONTEXT_WARNING_PCT = 80

type ContextPercent = number | null

function asFinitePercent(contextPercent: ContextPercent): ContextPercent {
	if (contextPercent === null || !Number.isFinite(contextPercent)) return null
	return contextPercent
}

function contextColor(percent: number): string {
	if (percent < CONTEXT_COMFORT_PCT) return LATTE.green
	if (percent < CONTEXT_WARNING_PCT) return LATTE.peach
	return LATTE.red
}

function contextMeterBar(percent: number, color: string): string {
	const filled = Math.round((percent / PERCENT_SCALE) * BAR_WIDTH)
	const meterFull = fgHex(color, BAR_FULL.repeat(filled))
	const meterEmpty = fgHex(
		LATTE.surface1,
		BAR_EMPTY.repeat(BAR_WIDTH - filled),
	)
	return meterFull + meterEmpty
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

export function contextGroup(
	usage: ContextUsage,
	willShowExactTokens: boolean,
): string {
	const percent = asFinitePercent(usage.percent)
	if (percent === null) return ''
	const pct = Math.round(percent)
	const color = contextColor(percent)
	const bar = contextMeterBar(percent, color)
	const exact = contextExactTokens(
		usage.tokens,
		usage.contextWindow,
		willShowExactTokens,
	)
	return `${fgHex(LATTE.subtext0, ICONS.context)} ${bar} ${fgHex(color, `${pct}%`)}${exact}`
}
