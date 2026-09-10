// Reads DeepSeek's peak/off-peak windows from OpenRouter's model catalogue.
//
// DeepSeek publishes no pricing API, but OpenRouter carries the same schedule
// as per-window rate overrides on `deepseek/deepseek-v4.1-flash` - the model the
// first-party Flash names now resolve to (api-docs.deepseek.com/updates and
// /quick_start/pricing, 2026-09-10). The rates are never hardcoded: this payload
// is the only source. Clock bounds arrive as HHMM integers (100 reads as 01:00),
// and an override may name no clock bound at all (the weekend tier, all day) or
// no day list (every day).
//
// Decoding the third-party payload is the whole job here; the tariff's own
// arithmetic lives in tariff-deepseek.ts.

import { isRecord, finiteNumber, FIELD_NAN } from './json.ts'
import { fetchJsonWithHeaders } from './quotas.ts'

import type { DeepseekTariff, Rates, TariffWindow } from './tariff-deepseek.ts'

/** OpenRouter entry whose pricing carries the peak/off-peak windows. */
const PRICING_MODEL_ID = 'deepseek/deepseek-v4.1-flash'

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'

/** Day names as OpenRouter writes them, indexed by JS `getUTCDay()`. */
const UTC_DAY_NAMES = [
	'sunday',
	'monday',
	'tuesday',
	'wednesday',
	'thursday',
	'friday',
	'saturday',
]
const ALL_UTC_DAYS = [...UTC_DAY_NAMES.keys()]

const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24
const MINUTES_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR
const MINUTES_PER_UNIT = 100

/** OpenRouter encodes UTC clock bounds as HHMM, so 1030 reads as 10:30. */
function minuteOfDay(raw: unknown): number {
	const encoded = finiteNumber(raw)
	if (!Number.isFinite(encoded)) return FIELD_NAN
	const minute =
		Math.floor(encoded / MINUTES_PER_UNIT) * MINUTES_PER_HOUR +
		(encoded % MINUTES_PER_UNIT)
	return minute >= 0 && minute <= MINUTES_PER_DAY ? minute : FIELD_NAN
}

/** Window days as UTC day indexes; an absent list means every day. */
function windowDays(raw: unknown): readonly number[] | undefined {
	if (!raw) return ALL_UTC_DAYS
	if (!Array.isArray(raw)) return undefined
	const days = raw.map(day =>
		typeof day === 'string' ? UTC_DAY_NAMES.indexOf(day.toLowerCase()) : -1,
	)
	if (!days.length) return undefined
	if (!days.every(day => day >= 0)) return undefined
	return days
}

/**
 * Clock bounds of a window as minutes into the UTC day. An override naming no
 * clock bound at all covers the whole day.
 */
function windowClock(override: Record<string, unknown>): [number, number] {
	if (!('utc_start' in override) && !('utc_end' in override)) {
		return [0, MINUTES_PER_DAY]
	}
	return [minuteOfDay(override.utc_start), minuteOfDay(override.utc_end)]
}

/** Rates of one tier entry; every cache level falls back to the tier below. */
function mergedRates(entry: Record<string, unknown>, base: Rates): Rates {
	const input = finiteNumber(entry.prompt)
	const output = finiteNumber(entry.completion)
	const cacheRead = finiteNumber(entry.input_cache_read)
	return {
		input: Number.isFinite(input) ? input : base.input,
		output: Number.isFinite(output) ? output : base.output,
		cacheRead: Number.isFinite(cacheRead) ? cacheRead : base.cacheRead,
	}
}

/** Base tier of a price list; undefined when it prices no input or output. */
function baseRates(pricing: Record<string, unknown>): Rates | undefined {
	const input = finiteNumber(pricing.prompt)
	const output = finiteNumber(pricing.completion)
	if (!Number.isFinite(input) || !Number.isFinite(output)) return undefined
	const cacheRead = finiteNumber(pricing.input_cache_read)
	return {
		input,
		output,
		cacheRead: Number.isFinite(cacheRead) ? cacheRead : 0,
	}
}

function parseWindow(override: unknown, base: Rates): TariffWindow | undefined {
	if (!isRecord(override)) return undefined
	const [startMinute, endMinute] = windowClock(override)
	const days = windowDays(override.utc_days)
	if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute)) {
		return undefined
	}
	if (!days) return undefined
	// An end at or before the start runs to the end of the day (utc_end 0).
	const end = endMinute <= startMinute ? MINUTES_PER_DAY : endMinute
	return {
		days,
		startMinute,
		endMinute: end,
		rates: mergedRates(override, base),
	}
}

function parseWindows(raw: unknown, base: Rates): TariffWindow[] {
	if (!Array.isArray(raw)) return []
	const windows: TariffWindow[] = []
	for (const override of raw) {
		const window = parseWindow(override, base)
		if (window) windows.push(window)
	}
	return windows
}

function parsePricingEntry(
	entry: Record<string, unknown>,
): DeepseekTariff | undefined {
	const { pricing } = entry
	if (!isRecord(pricing)) return undefined
	const base = baseRates(pricing)
	if (!base) return undefined
	const windows = parseWindows(pricing.overrides, base)
	const windowRates = windows.map(window => window.rates.input)
	return {
		base,
		windows,
		peakInputRate: Math.max(base.input, ...windowRates),
	}
}

/** The DeepSeek Flash tariff of a model catalogue, or undefined without one. */
export function parseDeepseekTariff(
	response: unknown,
): DeepseekTariff | undefined {
	if (!isRecord(response) || !Array.isArray(response.data)) return undefined
	const entry = response.data.find(
		model => isRecord(model) && model.id === PRICING_MODEL_ID,
	)
	if (!isRecord(entry)) return undefined
	return parsePricingEntry(entry)
}

/** One catalogue read; the tariff is a small slice of an otherwise heavy payload. */
export async function pollDeepseekTariff(): Promise<
	DeepseekTariff | undefined
> {
	return parseDeepseekTariff(
		await fetchJsonWithHeaders(OPENROUTER_MODELS_URL, {}),
	)
}
