import { PI_PALETTE as LATTE } from '../ui/design-system/palette.ts'
import { foregroundHex as fgHex } from '../ui/design-system/terminal-color.ts'

import {
	balanceColor,
	fmtBoundary,
	fmtReset,
	quotaGauge,
	PERCENT_SCALE,
} from './gauge.ts'
import { currencySymbol, deepseekBalanceUsd } from './quota-deepseek.ts'
import { XAI_POOL_LABELS } from './quotas.ts'
// Right-side quota strip rendering: one segment per billing backend plus the
// dispatcher that selects the parts of the active provider. Compact mode
// trades the reset stamps for width on degraded screens.
import { thinSep } from './text.ts'
import { ICONS } from './theme.ts'

import type {
	DeepseekQuota,
	KimiQuota,
	OpenAIQuota,
	OpenRouterQuota,
	QuotaCache,
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

const QUIET = (text: string): string => fgHex(LATTE.subtext0, text)

/** OpenAI credit rows print with cents precision. */
const CREDITS_DECIMALS = 2

/** Unrecognized provider: `inco │ no quota data` - no invented numbers. */
export function noQuotaDataPart(provider: string): string {
	const label = fgHex(LATTE.overlay1, 'no quota data')
	if (!provider.length) return label
	return `${QUIET(provider)} ${thinSep()} ${label}`
}

function resetRun(stamps: string[]): string {
	const joined = stamps.map(stamp => fmtReset(stamp)).join(' \u00b7 ')
	return `${ICONS.reset} ${joined}`
}

function kimiSegment(quota: KimiQuota, options: QuotaRenderOptions): string {
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
function deepseekSegment(
	quota: DeepseekQuota,
	options: QuotaRenderOptions,
): string {
	const tint = balanceColor(deepseekBalanceUsd(quota))
	const amount = `${currencySymbol(quota.currency)}${quota.balance.toFixed(CREDITS_DECIMALS)}`
	const badge = tariffBadge(options.tier, options)
	const balance = `${QUIET('deepseek')} ${fgHex(tint, '\u25c9')} ${fgHex(tint, amount)}`
	return badge ? `${balance} ${thinSep()} ${badge}` : balance
}

function openRouterSegment(quota: OpenRouterQuota): string {
	const tint = balanceColor(quota.balance)
	let segment = `${QUIET('openrouter')} ${fgHex(tint, '\u25c9')} ${fgHex(tint, `$${quota.balance.toFixed(CREDITS_DECIMALS)}`)}`
	if (quota.weekly) {
		// The /auth/key weekly cap carries no reset stamp - the gauge is all we can show.
		segment += ` ${thinSep()} ${QUIET('hebdo')} ${quotaGauge(quota.weekly.remaining, quota.weekly.limit)}`
	}
	return segment
}

function openaiSegment(
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

function xaiSegment(quota: XaiQuota, options: QuotaRenderOptions): string {
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

/** Compose the full quota strip for one provider snapshot. */
export function quotaStrip(
	quotas: QuotaCache,
	provider: string | undefined,
	options: QuotaRenderOptions = {},
): string {
	const activeProvider = (provider ?? '').toLowerCase()
	const parts = activeProviderParts(quotas, activeProvider, options)
	if (parts.length) return quotaContent(parts)
	// Providers without a pollable billing API, and backends that returned
	// nothing, state their absence rather than echo other providers' quotas.
	return quotaContent([noQuotaDataPart(activeProvider)])
}

/** Segments of the active provider, in the classic footer order. */
function activeProviderParts(
	quotas: QuotaCache,
	activeProvider: string,
	options: QuotaRenderOptions,
): string[] {
	const { kimi, openrouter, openai, xai, deepseek } = quotas
	const parts: string[] = []
	if (kimi && activeProvider.includes('kimi')) {
		parts.push(kimiSegment(kimi, options))
	}
	if (openrouter && activeProvider.includes('openrouter')) {
		parts.push(openRouterSegment(openrouter))
	}
	if (openai && activeProvider.includes('openai')) {
		parts.push(openaiSegment(openai, options))
	}
	if (xai && activeProvider.includes('xai')) {
		parts.push(xaiSegment(xai, options))
	}
	if (deepseek && activeProvider.includes('deepseek')) {
		parts.push(deepseekSegment(deepseek, options))
	}
	return parts
}

function quotaContent(parts: string[]): string {
	if (!parts.length) return ''
	return `${fgHex(LATTE.subtext0, ICONS.quota)} ${parts.join(` ${thinSep()} `)}`
}
