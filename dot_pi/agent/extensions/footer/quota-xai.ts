// xAI (Grok / X subscription) quota: the cli-chat-proxy billing endpoints.
// Polling flow for one backend; orchestration lives in poll-quotas.ts and
// rendering in render-quota.ts.

import { PERCENT_SCALE } from './gauge.ts'
import { finiteNumber, isRecord, valOf } from './json.ts'
import { fetchJsonWithHeaders, readToken, XAI_POOL_LABELS } from './quotas.ts'

import type { XaiQuota } from './quotas.ts'

// ── xAI (Grok / X subscription) - cli-chat-proxy billing endpoints ────
const XAI_PROVIDER_KEY = 'xai'
const XAI_PROXY_BASE = 'https://cli-chat-proxy.grok.com/v1'
const XAI_PERIOD_WEEKLY = 'USAGE_PERIOD_TYPE_WEEKLY'
const XAI_PERIOD_MONTHLY = 'USAGE_PERIOD_TYPE_MONTHLY'

function xaiHeaders(token: string): Record<string, string> {
	return {
		Authorization: `Bearer ${token}`,
		'x-xai-token-auth': 'xai-grok-cli',
		Accept: 'application/json',
	}
}

/** Response payload forms that bill xAI expose a `config` envelope. */
function xaiConfigRecord(
	response: unknown,
): Record<string, unknown> | undefined {
	if (!isRecord(response)) return undefined
	if (!isRecord(response.config)) return undefined
	return response.config
}

function xaiTierFrom(
	settings: Record<string, unknown> | undefined,
): string | undefined {
	const tier = settings?.subscription_tier_display
	if (typeof tier !== 'string' || !tier.length) return undefined
	return tier
}

function xaiMonthlyFrom(
	billingConfig: Record<string, unknown> | undefined,
): XaiQuota['monthly'] {
	const limit = valOf(billingConfig?.monthlyLimit)
	const used = valOf(billingConfig?.used)
	if (!Number.isFinite(limit) || !Number.isFinite(used)) return undefined
	const reset = billingConfig?.billingPeriodEnd
	return {
		used,
		limit,
		reset: typeof reset === 'string' ? reset : '',
	}
}

/** Primary pool usage: creditUsagePercent, else onDemandUsed / onDemandCap. */
function xaiPoolPercent(creditsConfig: Record<string, unknown>): number {
	const percent = finiteNumber(creditsConfig.creditUsagePercent)
	if (Number.isFinite(percent)) {
		return Math.min(PERCENT_SCALE, Math.max(0, percent))
	}
	const cap = valOf(creditsConfig.onDemandCap)
	const used = valOf(creditsConfig.onDemandUsed)
	if (cap > 0 && Number.isFinite(used)) {
		return Math.min(
			PERCENT_SCALE,
			Math.max(0, (used / cap) * PERCENT_SCALE),
		)
	}
	// A parseable period with neither value means zero usage (CodexBar)
	return 0
}

function xaiPoolFrom(
	creditsConfig: Record<string, unknown> | undefined,
): XaiQuota['pool'] {
	if (!creditsConfig) return undefined
	const period = creditsConfig.currentPeriod
	if (!isRecord(period)) return undefined
	const periodType = period.type
	const isBillablePeriod =
		periodType === XAI_PERIOD_WEEKLY || periodType === XAI_PERIOD_MONTHLY
	if (!isBillablePeriod) return undefined
	const periodEnd = period.end
	const reset = creditsConfig.billingPeriodEnd ?? periodEnd
	return {
		usedPercent: xaiPoolPercent(creditsConfig),
		reset: typeof reset === 'string' ? reset : '',
		label:
			periodType === XAI_PERIOD_MONTHLY
				? XAI_POOL_LABELS.monthly
				: XAI_POOL_LABELS.weekly,
	}
}

export async function pollXaiQuotas(): Promise<XaiQuota | undefined> {
	const token = readToken(XAI_PROVIDER_KEY)
	if (!token) return undefined
	const headers = xaiHeaders(token)
	const [billingResponse, creditsResponse, settingsResponse] =
		await Promise.all([
			fetchJsonWithHeaders(`${XAI_PROXY_BASE}/billing`, headers),
			fetchJsonWithHeaders(
				`${XAI_PROXY_BASE}/billing?format=credits`,
				headers,
			),
			fetchJsonWithHeaders(`${XAI_PROXY_BASE}/settings`, headers),
		])
	const settings = isRecord(settingsResponse) ? settingsResponse : undefined
	const billingConfig = xaiConfigRecord(billingResponse)
	const creditsConfig = xaiConfigRecord(creditsResponse)
	const quota: XaiQuota = {}
	const tier = xaiTierFrom(settings)
	if (tier) quota.tier = tier
	const monthly = xaiMonthlyFrom(billingConfig)
	if (monthly) quota.monthly = monthly
	const pool = xaiPoolFrom(creditsConfig)
	if (pool) quota.pool = pool
	const prepaidBalance = valOf(creditsConfig?.prepaidBalance)
	if (prepaidBalance > 0) quota.prepaidBalance = prepaidBalance
	return quota
}
