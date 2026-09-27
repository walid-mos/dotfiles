// DeepSeek's time-of-day Flash tariff: peak runs 01:00-04:00 and 06:00-10:00
// UTC on weekdays, off-peak is half price at the time of writing. The windows
// and rates behind this type come from the live model catalogue - see
// tariff-catalogue.ts for where they are read from.
//
// DeepSeek bills no cache writes: its usage reports cacheWrite as 0 and its
// price list carries no cache-write rate, so a re-priced turn has no cache-write
// term. Pure: rates, tiers and boundaries, no IO and no parsing.

/** USD per token for one rate tier. */
export type Rates = {
	input: number
	output: number
	cacheRead: number
}

/** One rate window: whole UTC days, half-open minute range `[start, end)`. */
export type TariffWindow = {
	days: readonly number[]
	startMinute: number
	endMinute: number
	rates: Rates
}

export type DeepseekTariff = {
	/** The tariff's most expensive input rate: the tier DeepSeek calls peak. */
	peakInputRate: number
	/** Rates outside every window. */
	base: Rates
	windows: readonly TariffWindow[]
}

/** The tier in effect, and the instant the tariff moves to the other one. */
export type TariffTier = {
	peak: boolean
	until: Date | undefined
}

/**
 * First-party DeepSeek models served by the V4.1 Flash price list. The legacy
 * names are aliases of V4.1 Flash until DeepSeek retires them.
 */
const FIRST_PARTY_MODEL_IDS = new Set([
	'deepseek-flash',
	'deepseek-v4-flash',
	'deepseek-v4-flash-vision-exp',
])

const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24
const MS_PER_MINUTE = 60_000
const MS_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR * MS_PER_MINUTE

/** A weekly schedule's next change always falls within one week. */
const DAYS_AHEAD = 7

/** Whether a session model is billed by the DeepSeek Flash tariff. */
export function usesDeepseekTariff(
	provider: string | undefined,
	model: string | undefined,
): boolean {
	return (
		provider?.toLowerCase() === 'deepseek' &&
		FIRST_PARTY_MODEL_IDS.has(model ?? '')
	)
}

/** Rates in effect at an instant: first matching window, else the base tier. */
export function ratesAt(tariff: DeepseekTariff, at: Date): Rates {
	const day = at.getUTCDay()
	const minute = at.getUTCHours() * MINUTES_PER_HOUR + at.getUTCMinutes()
	const window = tariff.windows.find(
		candidate =>
			candidate.days.includes(day) &&
			minute >= candidate.startMinute &&
			minute < candidate.endMinute,
	)
	if (!window) return tariff.base
	const { rates } = window
	return rates
}

/** Whether the tariff in effect at an instant is the expensive peak tier. */
export function isPeakRate(tariff: DeepseekTariff, at: Date): boolean {
	return ratesAt(tariff, at).input >= tariff.peakInputRate
}

/** Whether any window is priced away from the base tier. */
export function hasTiers(tariff: DeepseekTariff): boolean {
	return tariff.windows.some(
		window => window.rates.input !== tariff.base.input,
	)
}

/** Every start and end minute the tariff's windows name. */
function windowMinutes(tariff: DeepseekTariff): number[] {
	return tariff.windows.flatMap(window => [
		window.startMinute,
		window.endMinute,
	])
}

/**
 * Every window bound over the coming week, from the start of the UTC day of
 * `at`. A bound is an instant a window's rates can start or stop applying, so
 * the schedule's next change is the first of these in the future.
 */
function windowBounds(tariff: DeepseekTariff, at: Date): Date[] {
	const dayStart = Date.UTC(
		at.getUTCFullYear(),
		at.getUTCMonth(),
		at.getUTCDate(),
	)
	const minutes = windowMinutes(tariff)
	const bounds: Date[] = []
	for (let day = 0; day <= DAYS_AHEAD; day += 1) {
		const dayOffset = dayStart + day * MS_PER_DAY
		for (const minute of minutes) {
			bounds.push(new Date(dayOffset + minute * MS_PER_MINUTE))
		}
	}
	return bounds
}

/** Instant the tariff next switches tier, or undefined without tiers. */
export function nextTierChange(
	tariff: DeepseekTariff,
	at: Date,
): Date | undefined {
	if (!hasTiers(tariff)) return undefined
	const peak = isPeakRate(tariff, at)
	return windowBounds(tariff, at)
		.filter(bound => bound > at)
		.toSorted((left, right) => left.getTime() - right.getTime())
		.find(bound => isPeakRate(tariff, bound) !== peak)
}

/**
 * Tier the active model is billed at, and when it changes. Undefined for a
 * model outside the tariff, and for one whose price list has no tiers.
 */
export function deepseekTier(
	tariff: DeepseekTariff | null,
	at: Date,
	provider: string | undefined,
	model: string | undefined,
): TariffTier | undefined {
	if (!tariff || !hasTiers(tariff)) return undefined
	if (!usesDeepseekTariff(provider, model)) return undefined
	return { peak: isPeakRate(tariff, at), until: nextTierChange(tariff, at) }
}
