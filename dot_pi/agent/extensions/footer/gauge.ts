import { PI_PALETTE as LATTE } from '../ui/design-system/palette.ts'
import {
	blendHex,
	foregroundHex as fgHex,
} from '../ui/design-system/terminal-color.ts'

// Quota and balance gauges: ratio → color ramps, meter glyphs and reset
// time shorthand. Pure mapping, no IO.

/**
 * Smooth RGB color ramp by remaining ratio. Anchored stops sorted high → low;
 * ratios above the first stop hold the first color, ratios below the last hold
 * the last color: 100% green → 60% yellow → 40% peach → 20% red.
 */
const QUOTA_STOPS = {
	fresh: { ratio: 1, color: LATTE.green },
	comfortable: { ratio: 0.6, color: LATTE.yellow },
	strained: { ratio: 0.4, color: LATTE.peach },
	critical: { ratio: 0.2, color: LATTE.red },
} as const

type QuotaStop = (typeof QUOTA_STOPS)[keyof typeof QUOTA_STOPS]

// Adjacent stop pairs, high ratio first
const QUOTA_BRACKETS: Array<{ upper: QuotaStop; lower: QuotaStop }> = [
	{ upper: QUOTA_STOPS.fresh, lower: QUOTA_STOPS.comfortable },
	{ upper: QUOTA_STOPS.comfortable, lower: QUOTA_STOPS.strained },
	{ upper: QUOTA_STOPS.strained, lower: QUOTA_STOPS.critical },
]

/** Credit balance thresholds in $ for the tint ladder. */
const BALANCE_COMFORTABLE_USD = 10
const BALANCE_LEISURE_USD = 5
const BALANCE_SCRAPING_USD = 2

/** Reset stamps print HH:MM while inside the same (French) day. */
const RESET_SOON_LIMIT_HOURS = 24
const MS_PER_HOUR = 3_600_000
const FRENCH_LOCALE = 'fr-FR'

/** Clock stamp for anything happening today: HH:MM in the house locale. */
export function fmtClock(time: Date): string {
	return time.toLocaleTimeString(FRENCH_LOCALE, {
		hour: '2-digit',
		minute: '2-digit',
	})
}

/** Local calendar day of an instant, for same-day comparisons. */
function localDay(time: Date): string {
	return time.toLocaleDateString(FRENCH_LOCALE)
}

/**
 * When a change lands: the clock time while it is still today, otherwise the
 * weekday it falls on - a bare clock time would read as "tonight" for a change
 * two days out.
 */
export function fmtBoundary(time: Date, now: Date): string {
	const clock = fmtClock(time)
	if (localDay(time) === localDay(now)) return clock
	const weekday = time.toLocaleDateString(FRENCH_LOCALE, { weekday: 'short' })
	return `${weekday} ${clock}`
}

/** Reset time: HH:MM if <24h away, else short date. */
export function fmtReset(iso: string): string {
	const stamped = new Date(iso)
	if (Number.isNaN(stamped.getTime())) return '?'
	const hoursUntilReset = (stamped.getTime() - Date.now()) / MS_PER_HOUR
	if (hoursUntilReset < RESET_SOON_LIMIT_HOURS) return fmtClock(stamped)
	return stamped.toLocaleDateString(FRENCH_LOCALE, {
		weekday: 'short',
		day: 'numeric',
	})
}

/** Circle dial segments for distinct quota-gauge look. */
const DIAL_FULL_THRESHOLD = 0.87
const DIAL_THREE_QUARTER_THRESHOLD = 0.62
const DIAL_HALF_THRESHOLD = 0.37
const DIAL_QUARTER_THRESHOLD = 0.12

const RATIO_MIN = 0
const RATIO_MAX = 1

/** Percent fields share the 0..100 scale across backends. */
export const PERCENT_SCALE = 100
export const PERCENT_FLOOR = 0

function blendStops(upper: QuotaStop, lower: QuotaStop, ratio: number): string {
	const span = upper.ratio - lower.ratio
	const weight = span === 0 ? 0 : (ratio - lower.ratio) / span
	return blendHex(lower.color, upper.color, weight)
}

/** Leftover-ratio color: brackets interpolate, extremes hold their stop. */
export function quotaColor(remaining: number, limit: number): string {
	const ratioInvalid =
		!Number.isFinite(remaining) || !Number.isFinite(limit) || limit <= 0
	if (ratioInvalid) return LATTE.subtext0
	const ratio = Math.max(RATIO_MIN, Math.min(RATIO_MAX, remaining / limit))
	const [firstBracket] = QUOTA_BRACKETS
	const lastBracket = QUOTA_BRACKETS[QUOTA_BRACKETS.length - 1]
	const topStop = firstBracket?.upper
	const floorStop = lastBracket?.lower
	if (topStop && ratio > topStop.ratio) return topStop.color
	if (floorStop && ratio < floorStop.ratio) return floorStop.color
	for (const bracket of QUOTA_BRACKETS) {
		if (ratio <= bracket.upper.ratio && ratio >= bracket.lower.ratio) {
			return blendStops(bracket.upper, bracket.lower, ratio)
		}
	}
	return floorStop?.color ?? LATTE.subtext0
}

/** Color for credit balance (no limit to compare against): thresholds in $. */
export function balanceColor(balance: number): string {
	if (balance >= BALANCE_COMFORTABLE_USD) return LATTE.green
	if (balance >= BALANCE_LEISURE_USD) return LATTE.yellow
	if (balance >= BALANCE_SCRAPING_USD) return LATTE.peach
	return LATTE.red
}

/** Circle fraction glyphs, visually distinct from the context meter bar. */
export function quotaDial(ratio: number): string {
	if (ratio > DIAL_FULL_THRESHOLD) return '●'
	if (ratio > DIAL_THREE_QUARTER_THRESHOLD) return '◕'
	if (ratio > DIAL_HALF_THRESHOLD) return '◑'
	if (ratio > DIAL_QUARTER_THRESHOLD) return '◔'
	return '○'
}

/** Dial + colored percentage of remaining quota. */
export function quotaGauge(remaining: number, limit: number): string {
	const stdInputs =
		!Number.isFinite(remaining) || !Number.isFinite(limit) || limit <= 0
	if (stdInputs) return fgHex(LATTE.subtext0, ' - ')
	// At hard zero remaining, still show 0% (not NaN / broken ANSI)
	const ratio = Math.max(RATIO_MIN, Math.min(RATIO_MAX, remaining / limit))
	const pct = Math.round(ratio * PERCENT_SCALE)
	const color = quotaColor(remaining, limit)
	return `${fgHex(color, quotaDial(ratio))} ${fgHex(color, `${pct}%`)}`
}
