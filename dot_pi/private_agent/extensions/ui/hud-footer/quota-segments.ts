import { PI_PALETTE as LATTE } from '#lib/ui/design-system/palette.ts'
import { foregroundHex as fgHex } from '#lib/ui/design-system/terminal-color.ts'

import {
	balanceColor,
	fmtBoundary,
	fmtReset,
	quotaGauge,
	PERCENT_SCALE,
} from './gauge.ts'
import { currencySymbol, deepseekBalanceUsd } from './quota-deepseek.ts'
import { XAI_POOL_LABELS } from './quotas.ts'
// Provider quota segments. Compact mode omits reset stamps to save width.
import { quietText as QUIET, thinSep } from './text.ts'
import { ICONS } from './theme.ts'

import type { IncoQuota } from './quota-inco.ts'
import type { ZaiQuota } from './quota-zai.ts'
import type {
	DeepseekQuota,
	KimiQuota,
	OpenAIQuota,
	OpenRouterQuota,
	XaiQuota,
} from './quotas.ts'
import type { TariffTier } from './tariff-deepseek.ts'

export type QuotaRenderOptions = {
	compact?: boolean | undefined
	/** Peak/off-peak tier of the active DeepSeek model, when it has one. */
	tier?: TariffTier | undefined
	/** Instant the tier's boundary stamp is read against. */
	now?: Date | undefined
}

/** OpenAI credit rows print with cents precision. */
const CREDITS_DECIMALS = 2

function resetRun(stamps: string[]): string {
	const joined = stamps.map(stamp => fmtReset(stamp)).join(' \u00b7 ')
	return `${ICONS.reset} ${joined}`
}

export function kimiSegment(
	quota: KimiQuota,
	options: QuotaRenderOptions,
): string {
	const { fiveHour, weekly } = quota
	let segment = `${QUIET('kimi')} ${QUIET('5h')} ${quotaGauge(fiveHour.remaining, fiveHour.limit)}`
	if (Number.isFinite(weekly.limit) && weekly.limit > 0) {
		segment += ` ${thinSep()} ${QUIET('sem')} ${quotaGauge(weekly.remaining, weekly.limit)}`
	}
	const stamps = options.compact
		? []
		: [fiveHour.reset, weekly.reset].filter(Boolean)
	if (stamps.length > 0) {
		segment += ` ${thinSep()} ${QUIET(resetRun(stamps))}`
	}
	return segment
}

/**
 * DeepSeek's tier as a badge: the tier always shows, the clock time it changes
 * is the first thing to go when the strip is compressed.
 */
function tariffBadge(
	tier: TariffTier | undefined,
	options: QuotaRenderOptions,
): string {
	if (!tier) return ''
	const label = tier.peak ? '\u25b2 peak' : '\u25bc off-peak'
	const tint = tier.peak ? LATTE.peach : LATTE.green
	const badge = fgHex(tint, label)
	if (options.compact || !tier.until) return badge
	const until = fmtBoundary(tier.until, options.now ?? new Date())
	return `${badge} ${QUIET(`until ${until}`)}`
}

/** DeepSeek prints the currency it bills in, tinted by its USD equivalent. */
export function deepseekSegment(
	quota: DeepseekQuota,
	options: QuotaRenderOptions,
): string {
	const tint = balanceColor(deepseekBalanceUsd(quota))
	const amount = `${currencySymbol(quota.currency)}${quota.balance.toFixed(CREDITS_DECIMALS)}`
	const badge = tariffBadge(options.tier, options)
	const balance = `${QUIET('deepseek')} ${fgHex(tint, '\u25c9')} ${fgHex(tint, amount)}`
	return badge ? `${balance} ${thinSep()} ${badge}` : balance
}

/**
 * Inco prints the credit balance the console printed, down to its fractional
 * cents: rounding to cents would show credit the prepaid account cannot spend.
 */
export function incoSegment(quota: IncoQuota): string {
	const tint = balanceColor(quota.balance)
	return `${QUIET('inco')} ${fgHex(tint, '\u25c9')} ${fgHex(tint, quota.amount)}`
}

export function openRouterSegment(quota: OpenRouterQuota): string {
	const tint = balanceColor(quota.balance)
	let segment = `${QUIET('openrouter')} ${fgHex(tint, '\u25c9')} ${fgHex(tint, `$${quota.balance.toFixed(CREDITS_DECIMALS)}`)}`
	if (quota.weekly) {
		// The /auth/key weekly cap carries no reset stamp - the gauge is all we can show.
		segment += ` ${thinSep()} ${QUIET('hebdo')} ${quotaGauge(quota.weekly.remaining, quota.weekly.limit)}`
	}
	return segment
}

export function openaiSegment(
	quota: OpenAIQuota,
	options: QuotaRenderOptions,
): string {
	const head = quota.plan
		? `${QUIET('openai')} ${fgHex(LATTE.mauve, quota.plan)}`
		: QUIET('openai')
	const windowParts = quota.windows.map(
		usageWindow =>
			`${QUIET(usageWindow.label)} ${quotaGauge(PERCENT_SCALE - usageWindow.usedPercent, PERCENT_SCALE)}`,
	)
	const extraParts = [...windowParts]
	if (!options.compact) {
		const stamps = quota.windows
			.map(usageWindow => usageWindow.reset)
			.filter(Boolean)
		if (stamps.length > 0) extraParts.push(QUIET(resetRun(stamps)))
	}
	// Parse-side only assigns positive balances, so truthiness is exact here
	if (quota.credits) {
		const tint = balanceColor(quota.credits)
		extraParts.push(
			`${fgHex(tint, '\u25c9')} ${fgHex(tint, `$${quota.credits.toFixed(CREDITS_DECIMALS)}`)} ${QUIET('crédits')}`,
		)
	}
	if (quota.resets) {
		const plural = quota.resets > 1 ? 's' : ''
		extraParts.push(QUIET(`${quota.resets} reset${plural}`))
	}
	if (!extraParts.length) {
		return `${head} ${fgHex(LATTE.subtext0, ' - ')}`
	}
	return `${head} ${extraParts.join(` ${thinSep()} `)}`
}

export function xaiSegment(
	quota: XaiQuota,
	options: QuotaRenderOptions,
): string {
	const bits: string[] = []
	const stamps: string[] = []
	if (quota.tier) bits.push(fgHex(LATTE.mauve, quota.tier))
	const { monthly, pool, prepaidBalance } = quota
	if (
		monthly &&
		monthly.limit > 0 &&
		pool?.label !== XAI_POOL_LABELS.monthly
	) {
		const remaining = monthly.limit - monthly.used
		bits.push(
			`${QUIET(XAI_POOL_LABELS.monthly)} ${quotaGauge(remaining, monthly.limit)}`,
		)
		if (monthly.reset) stamps.push(monthly.reset)
	}
	if (pool && Number.isFinite(pool.usedPercent)) {
		const remainingPercent = PERCENT_SCALE - pool.usedPercent
		bits.push(
			`${QUIET(pool.label)} ${quotaGauge(remainingPercent, PERCENT_SCALE)}`,
		)
		if (pool.reset) stamps.push(pool.reset)
	}
	if (!options.compact && stamps.length > 0) {
		bits.push(QUIET(resetRun(stamps)))
	}
	if (prepaidBalance && prepaidBalance > 0) {
		const tint = balanceColor(prepaidBalance)
		bits.push(
			`${fgHex(tint, '\u25c9')} ${fgHex(tint, `$${prepaidBalance.toFixed(CREDITS_DECIMALS)}`)}`,
		)
	}
	return bits.length > 0
		? `${QUIET('xai')} ${bits.join(` ${thinSep()} `)}`
		: `${QUIET('xai')} ${QUIET('\u2014')}`
}

/** Z.AI prints the plan badge plus its two credit windows, Kimi-style. */
export function zaiSegment(
	quota: ZaiQuota,
	options: QuotaRenderOptions,
): string {
	const { fiveHour, weekly } = quota
	const head = quota.plan
		? `${QUIET('zai')} ${fgHex(LATTE.mauve, quota.plan)}`
		: QUIET('zai')
	let segment = `${head} ${QUIET('5h')} ${quotaGauge(fiveHour.remaining, fiveHour.limit)}`
	if (weekly.limit > 0) {
		segment += ` ${thinSep()} ${QUIET('sem')} ${quotaGauge(weekly.remaining, weekly.limit)}`
	}
	const stamps = options.compact
		? []
		: [fiveHour.reset, weekly.reset].filter(Boolean)
	if (stamps.length > 0) {
		segment += ` ${thinSep()} ${QUIET(resetRun(stamps))}`
	}
	return segment
}
