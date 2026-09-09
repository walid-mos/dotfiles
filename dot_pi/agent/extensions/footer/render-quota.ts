import { PI_PALETTE as LATTE } from '../ui/design-system/palette.ts'
import { foregroundHex as fgHex } from '../ui/design-system/terminal-color.ts'

import { balanceColor, fmtReset, quotaGauge, PERCENT_SCALE } from './gauge.ts'
import { XAI_POOL_LABELS } from './quotas.ts'
// Right-side quota strip rendering: one segment per billing backend plus the
// dispatcher that selects the parts of the active provider. Compact mode
// trades the reset stamps for width on degraded screens.
import { thinSep } from './text.ts'
import { ICONS } from './theme.ts'

import type {
	KimiQuota,
	OpenAIQuota,
	OpenRouterQuota,
	QuotaCache,
	XaiQuota,
} from './quotas.ts'

export type QuotaRenderOptions = { compact?: boolean }

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
	const showsXai = activeProvider.includes('xai')
	const showsKimi = activeProvider.includes('kimi')
	const showsOpenRouter = activeProvider.includes('openrouter')
	const showsOpenai = activeProvider.includes('openai')
	// Providers without a pollable billing API state their absence rather
	// than echo unrelated providers' quotas.
	const showsNothing =
		!showsXai && !showsKimi && !showsOpenRouter && !showsOpenai
	if (showsNothing) return quotaContent([noQuotaDataPart(activeProvider)])
	const parts: string[] = []
	if (quotas.kimi && showsKimi) parts.push(kimiSegment(quotas.kimi, options))
	if (quotas.openrouter && showsOpenRouter) {
		parts.push(openRouterSegment(quotas.openrouter))
	}
	if (quotas.openai && showsOpenai)
		parts.push(openaiSegment(quotas.openai, options))
	if (quotas.xai && showsXai) parts.push(xaiSegment(quotas.xai, options))
	return quotaContent(parts)
}

function quotaContent(parts: string[]): string {
	if (!parts.length) return ''
	return `${fgHex(LATTE.subtext0, ICONS.quota)} ${parts.join(` ${thinSep()} `)}`
}
