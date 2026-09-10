import assert from 'node:assert/strict'
import test from 'node:test'

import { stripTerminalSequences } from '@earendil-works/pi-tui'

import { fmtBoundary, fmtClock } from '../extensions/footer/gauge.ts'
import { quotaStrip } from '../extensions/footer/render-quota.ts'
import { renderFooterLines } from '../extensions/footer/render.ts'
import { parseDeepseekTariff } from '../extensions/footer/tariff-catalogue.ts'
import {
	deepseekTier,
	hasTiers,
	isPeakRate,
	nextTierChange,
	ratesAt,
	usesDeepseekTariff,
} from '../extensions/footer/tariff-deepseek.ts'
import { tokenTotals } from '../extensions/footer/tokens.ts'

import type { AssistantMessage, Usage } from '@earendil-works/pi-ai'
import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import type { FooterRenderInput } from '../extensions/footer/render.ts'
import type {
	DeepseekTariff,
	TariffTier,
} from '../extensions/footer/tariff-deepseek.ts'

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
const WEEKEND = ['saturday', 'sunday']

/** Peak tier: 01:00-04:00 and 06:00-10:00 UTC on weekdays. */
const PEAK = {
	prompt: '0.0000003',
	completion: '0.0000012',
	input_cache_read: '0.000000006',
}
/** Off-peak tier: everything else, at half the peak rates. */
const OFF_PEAK = {
	prompt: '0.00000015',
	completion: '0.0000006',
	input_cache_read: '0.000000003',
}

type RatesEntry = typeof PEAK
type WindowEntry = RatesEntry & {
	utc_days: string[]
	utc_start: number
	utc_end: number
}

function weekdayWindow(
	utcStart: number,
	utcEnd: number,
	rates: RatesEntry,
): WindowEntry {
	return {
		utc_days: WEEKDAYS,
		utc_start: utcStart,
		utc_end: utcEnd,
		...rates,
	}
}

/** Verbatim GET https://openrouter.ai/api/v1/models (2026-09-10), trimmed. */
const MODELS_RESPONSE = {
	data: [
		{
			id: 'deepseek/deepseek-v4-flash-vision-exp',
			pricing: {
				prompt: '0.00000022',
				completion: '0.00000066',
				input_cache_read: '0.000000007',
			},
		},
		{
			id: 'deepseek/deepseek-v4.1-flash',
			pricing: {
				...PEAK,
				overrides: [
					{ utc_days: WEEKEND, ...OFF_PEAK },
					weekdayWindow(0, 100, OFF_PEAK),
					weekdayWindow(100, 400, PEAK),
					weekdayWindow(400, 600, OFF_PEAK),
					weekdayWindow(600, 1000, PEAK),
					weekdayWindow(1000, 0, OFF_PEAK),
				],
			},
		},
	],
}

function tariffOrThrow(response: unknown = MODELS_RESPONSE): DeepseekTariff {
	const tariff = parseDeepseekTariff(response)
	assert.ok(tariff, 'the fixture carries the DeepSeek pricing entry')
	return tariff
}

/** Thursday 02:00 UTC - inside the first weekday peak window. */
const WEEKDAY_PEAK = new Date('2026-09-10T02:00:00.000Z')
/** Thursday 05:00 UTC - between the two peak windows. */
const WEEKDAY_OFF_PEAK = new Date('2026-09-10T05:00:00.000Z')
/** Saturday 02:00 UTC - a peak clock hour on a weekend day. */
const WEEKEND_PEAK_HOUR = new Date('2026-09-12T02:00:00.000Z')

function usageOf(input: number, output: number, cacheRead: number): Usage {
	return {
		input,
		output,
		cacheRead,
		cacheWrite: 0,
		totalTokens: input + output + cacheRead,
		cost: {
			// Deliberately wrong: a tariff must not fall back to these numbers
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0,
		},
	}
}

function assistantEntry(
	timestamp: string,
	provider: string,
	model: string,
	usage: Usage,
): SessionEntry {
	const message: AssistantMessage = {
		role: 'assistant',
		content: [],
		api: 'openai-completions',
		provider,
		model,
		usage,
		stopReason: 'stop',
		timestamp: Date.parse(timestamp),
	}
	return {
		type: 'message',
		id: `entry-${timestamp}`,
		parentId: null,
		timestamp,
		message,
	}
}

/** Nano-dollar precision: far below a cent, above double-precision noise. */
function dollars(cost: number): string {
	return cost.toFixed(9)
}

void test('parses the published rate table with its six windows', () => {
	const tariff = tariffOrThrow()

	assert.equal(tariff.base.input, 0.0000003)
	assert.equal(tariff.base.output, 0.0000012)
	assert.equal(tariff.base.cacheRead, 0.000000006)
	assert.equal(tariff.windows.length, 6)
	assert.equal(tariff.peakInputRate, 0.0000003)
	assert.ok(hasTiers(tariff))
})

void test('rejects catalogues without the pricing entry', () => {
	for (const payload of [
		undefined,
		null,
		'nope',
		{},
		{ data: 'nope' },
		{ data: [] },
		{ data: [{ id: 'deepseek/deepseek-v4.1-flash' }] },
		{
			data: [
				{
					id: 'deepseek/deepseek-v4.1-flash',
					pricing: { completion: '0.0000012' },
				},
			],
		},
	]) {
		assert.equal(
			parseDeepseekTariff(payload),
			undefined,
			`payload ${JSON.stringify(payload)} carries no tariff`,
		)
	}
})

void test('reads the tier in effect from UTC weekday and clock', () => {
	const tariff = tariffOrThrow()
	const offPeak = {
		input: 0.00000015,
		output: 0.0000006,
		cacheRead: 0.000000003,
	}
	const peak = {
		input: 0.0000003,
		output: 0.0000012,
		cacheRead: 0.000000006,
	}

	assert.deepEqual(ratesAt(tariff, WEEKDAY_PEAK), peak)
	assert.deepEqual(ratesAt(tariff, WEEKDAY_OFF_PEAK), offPeak)
	assert.deepEqual(ratesAt(tariff, WEEKEND_PEAK_HOUR), offPeak)
	assert.deepEqual(
		ratesAt(tariff, new Date('2026-09-10T07:30:00.000Z')),
		peak,
	)
	assert.deepEqual(
		ratesAt(tariff, new Date('2026-09-10T12:00:00.000Z')),
		offPeak,
	)
	assert.deepEqual(
		ratesAt(tariff, new Date('2026-09-10T00:30:00.000Z')),
		offPeak,
	)
	// 10:00 UTC is the exclusive end of the last peak window
	assert.deepEqual(
		ratesAt(tariff, new Date('2026-09-10T10:00:00.000Z')),
		offPeak,
	)

	assert.equal(isPeakRate(tariff, WEEKDAY_PEAK), true)
	assert.equal(isPeakRate(tariff, WEEKDAY_OFF_PEAK), false)
	assert.equal(isPeakRate(tariff, WEEKEND_PEAK_HOUR), false)
})

void test('prices the same turn at half rate outside peak hours', () => {
	const tariff = tariffOrThrow()
	const entry = assistantEntry(
		'2026-09-10T02:00:00.000Z',
		'deepseek',
		'deepseek-v4-flash',
		usageOf(1_000_000, 500_000, 2_000_000),
	)
	const offPeakEntry = assistantEntry(
		'2026-09-10T05:00:00.000Z',
		'deepseek',
		'deepseek-v4-flash',
		usageOf(1_000_000, 500_000, 2_000_000),
	)

	// 1M input x 0.3 + 0.5M output x 1.2 + 2M cacheRead x 0.006
	assert.equal(dollars(tokenTotals([entry], tariff).cost), '0.912000000')
	assert.equal(
		dollars(tokenTotals([offPeakEntry], tariff).cost),
		'0.456000000',
	)
})

void test('keeps pi cost for models outside the tariff and without one', () => {
	const tariff = tariffOrThrow()
	const foreign = usageOf(1_000_000, 500_000, 2_000_000)
	foreign.cost.total = 7.5
	const entry = assistantEntry(
		'2026-09-10T02:00:00.000Z',
		'openai-codex',
		'gpt-5.6-sol',
		foreign,
	)

	assert.equal(tokenTotals([entry], tariff).cost, 7.5)
	assert.equal(tokenTotals([entry], null).cost, 7.5)
})

void test('names the instant the tariff next switches tier', () => {
	const tariff = tariffOrThrow()
	const change = (iso: string): string =>
		(nextTierChange(tariff, new Date(iso)) ?? new Date(0)).toISOString()

	// Thursday 02:00 peak ends at 04:00; 05:00 off-peak ends when peak resumes
	assert.equal(change('2026-09-10T02:00:00.000Z'), '2026-09-10T04:00:00.000Z')
	assert.equal(change('2026-09-10T05:00:00.000Z'), '2026-09-10T06:00:00.000Z')
	// 10:00 off-peak runs to 01:00 the next day
	assert.equal(change('2026-09-10T10:00:00.000Z'), '2026-09-11T01:00:00.000Z')
	// Saturday is off-peak all day, until Monday's first peak window
	assert.equal(change('2026-09-12T02:00:00.000Z'), '2026-09-14T01:00:00.000Z')
})

void test('reports the tier with its boundary, and only for tariffed models', () => {
	const tariff = tariffOrThrow()
	const tier = deepseekTier(
		tariff,
		WEEKDAY_PEAK,
		'deepseek',
		'deepseek-v4-flash',
	)

	assert.equal(tier?.peak, true)
	assert.equal(tier?.until?.toISOString(), '2026-09-10T04:00:00.000Z')
	assert.equal(
		deepseekTier(tariff, WEEKDAY_PEAK, 'openai-codex', 'gpt-5.6-sol'),
		undefined,
	)
	assert.equal(
		deepseekTier(null, WEEKDAY_PEAK, 'deepseek', 'deepseek-v4-flash'),
		undefined,
	)
})

void test('covers the first-party names served by the V4.1 Flash price list', () => {
	assert.equal(usesDeepseekTariff('deepseek', 'deepseek-v4-flash'), true)
	assert.equal(usesDeepseekTariff('DeepSeek', 'deepseek-flash'), true)
	assert.equal(
		usesDeepseekTariff('deepseek', 'deepseek-v4-flash-vision-exp'),
		true,
	)
	assert.equal(usesDeepseekTariff('deepseek', 'deepseek-v4-pro'), false)
	assert.equal(usesDeepseekTariff('openrouter', 'deepseek-v4-flash'), false)
	assert.equal(usesDeepseekTariff(undefined, undefined), false)
})

function footerInput(
	tier: TariffTier | undefined,
	now: Date,
): FooterRenderInput {
	return {
		width: 200,
		model: 'deepseek-v4-flash',
		thinkingLevel: 'off',
		cwd: '~/development/app',
		branch: undefined,
		usage: undefined,
		tokens: { input: 0, output: 0, cost: 0.123 },
		statuses: [],
		git: null,
		pr: null,
		quotas: { deepseek: { balance: 110, currency: 'USD' } },
		provider: 'deepseek',
		tier,
		now,
	}
}

function footerLine2(input: FooterRenderInput): string {
	const [, line2 = ''] = renderFooterLines(input)
	return stripTerminalSequences(line2)
}

/** The active provider's credit segment, as the strip prints it. */
function creditSegment(
	tier: TariffTier | undefined,
	now: Date,
	isCompact?: boolean,
): string {
	const strip = quotaStrip(
		{ deepseek: { balance: 110, currency: 'USD' } },
		'deepseek',
		{ compact: isCompact, tier, now },
	)
	return stripTerminalSequences(strip)
}

/** The whole badge line for a tier read at one instant. */
function tierSegment(iso: string): string {
	const at = new Date(iso)
	const tier = deepseekTier(
		tariffOrThrow(),
		at,
		'deepseek',
		'deepseek-v4-flash',
	)
	return creditSegment(tier, at)
}

/** The stamp a local terminal prints for a boundary instant. */
function stampOf(iso: string): string {
	return fmtClock(new Date(iso))
}

void test('the credit segment names the tier and when it moves', () => {
	const peak = tierSegment('2026-09-10T02:00:00.000Z')
	const offPeak = tierSegment('2026-09-10T05:00:00.000Z')

	assert.ok(peak.includes('$110.00'), peak)
	// 02:00 peak runs to 04:00; 05:00 off-peak runs to the 06:00 window
	assert.ok(
		peak.includes(
			`\u25b2 peak until ${stampOf('2026-09-10T04:00:00.000Z')}`,
		),
		peak,
	)
	assert.ok(
		offPeak.includes(
			`\u25bc off-peak until ${stampOf('2026-09-10T06:00:00.000Z')}`,
		),
		offPeak,
	)
})

void test('a boundary beyond today names its weekday instead of the clock alone', () => {
	// Saturday off-peak ends Monday 01:00: 47h out, never the same local day
	const weekend = tierSegment('2026-09-12T02:00:00.000Z')

	assert.ok(/until [a-z]/i.test(weekend), weekend)
})

void test('boundary stamps keep the clock and add a day only when needed', () => {
	const now = new Date('2026-09-10T02:00:00.000Z')
	const today = fmtBoundary(new Date('2026-09-10T04:00:00.000Z'), now)
	const later = fmtBoundary(new Date('2026-09-14T01:00:00.000Z'), now)

	for (const stamp of [today, later]) {
		assert.ok(/\d{2}:\d{2}/.test(stamp), stamp)
	}
	assert.ok(!/[a-z]/i.test(today), today)
	assert.ok(/[a-z]/i.test(later), later)
})

void test('the credit segment drops the clock before the tier', () => {
	const at = WEEKDAY_PEAK
	const tier = deepseekTier(
		tariffOrThrow(),
		at,
		'deepseek',
		'deepseek-v4-flash',
	)

	const compact = creditSegment(tier, at, true)

	assert.ok(compact.includes('\u25b2 peak'), compact)
	assert.ok(!compact.includes('until'), compact)
})

void test('the credit segment stays bare without a tier', () => {
	const at = WEEKDAY_PEAK
	const tariff = tariffOrThrow()
	const foreign = deepseekTier(tariff, at, 'deepseek', 'deepseek-v4-pro')

	for (const tier of [undefined, foreign]) {
		const segment = creditSegment(tier, at)
		assert.ok(segment.includes('$110.00'), segment)
		assert.ok(!segment.includes('peak'), segment)
	}
})

void test('the cost group carries the spent amount alone', () => {
	const tier = deepseekTier(
		tariffOrThrow(),
		WEEKDAY_PEAK,
		'deepseek',
		'deepseek-v4-flash',
	)

	const line2 = footerLine2(footerInput(tier, WEEKDAY_PEAK)).trimEnd()

	assert.ok(line2.endsWith('$0.123'), line2)
})
