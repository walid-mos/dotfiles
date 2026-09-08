// Quota polling: one fetch-and-parse flow per billing backend, orchestrated
// sequentially (same request order as the original footer implementation).
// Rendering lives in render-quota.ts.

import { PERCENT_SCALE } from './gauge.ts'
import { isRecord, finiteNumber, valOf } from './json.ts'
import { parseOpenAIUsage, chatgptAccountIdFromToken } from './quota-openai.ts'
import {
	fetchJson,
	fetchJsonWithHeaders,
	parseKimiWindow,
	readToken,
	XAI_POOL_LABELS,
} from './quotas.ts'
import { readAuthField } from './quotas.ts'

import type {
	KimiQuota,
	OpenAIQuota,
	OpenRouterQuota,
	QuotaCache,
	XaiQuota,
} from './quotas.ts'

const KIMI_USAGE_URL = 'https://api.kimi.com/coding/v1/usages'
const KIMI_PROVIDER_KEY = 'kimi-coding'
const KIMI_FIVE_HOUR_MINUTES = 300
const KIMI_FIVE_HOUR_UNIT = 'TIME_UNIT_MINUTE'
const KIMI_DAY_UNIT = 'TIME_UNIT_DAY'
const KIMI_WEEK_DAYS_MIN = 7
const KIMI_WEEK_MINUTES = 10_080

type KimiLimitEntry = {
	window?: { duration?: unknown; timeUnit?: unknown }
	detail?: unknown
}

/** Kimi limit entries always carry a window object. */
function isKimiLimitEntry(entry: unknown): entry is KimiLimitEntry {
	return isRecord(entry) && isRecord(entry.window)
}

function kimiWindowUnit(entry: KimiLimitEntry): string {
	const unit = entry.window?.timeUnit
	return typeof unit === 'string' ? unit : ''
}

function kimiWindowDuration(entry: KimiLimitEntry): number {
	const duration = entry.window?.duration
	return typeof duration === 'number' ? duration : 0
}

/** The five-hour rate bucket is a 5-minute-window lookback of 300 minutes. */
function isFiveHourKimiLimit(entry: unknown): entry is KimiLimitEntry {
	if (!isKimiLimitEntry(entry)) return false
	return (
		kimiWindowDuration(entry) === KIMI_FIVE_HOUR_MINUTES &&
		kimiWindowUnit(entry) === KIMI_FIVE_HOUR_UNIT
	)
}

/** Weekly is a WEEK entry, a 7+-day DAY entry, or exactly 10080 minutes. */
function isWeeklyKimiLimit(entry: unknown): entry is KimiLimitEntry {
	if (!isKimiLimitEntry(entry)) return false
	const unit = kimiWindowUnit(entry)
	const duration = kimiWindowDuration(entry)
	const byUnit = unit.includes('WEEK')
		? true
		: unit === KIMI_DAY_UNIT && duration >= KIMI_WEEK_DAYS_MIN
	return byUnit || (duration === KIMI_WEEK_MINUTES && unit.includes('MINUTE'))
}

async function pollKimiQuotas(): Promise<KimiQuota | undefined> {
	const token = readToken(KIMI_PROVIDER_KEY)
	if (!token) return undefined
	const response = await fetchJson(KIMI_USAGE_URL, token)
	if (!isRecord(response)) return undefined
	const limits = Array.isArray(response.limits) ? response.limits : []
	const fiveHourEntry = limits.find(isFiveHourKimiLimit)
	const weeklyEntry = limits.find(isWeeklyKimiLimit)
	const fiveHour = parseKimiWindow(fiveHourEntry?.detail ?? fiveHourEntry)
	const weekly =
		parseKimiWindow(response.usage) ??
		parseKimiWindow(weeklyEntry?.detail ?? weeklyEntry)
	if (fiveHour && weekly) return { fiveHour, weekly }
	if (fiveHour) {
		// Show 5h alone rather than nothing / NaN when weekly shape drifts at 0
		return {
			fiveHour,
			weekly: { used: 0, limit: 0, remaining: 0, reset: '' },
		}
	}
	return undefined
}

const OPENROUTER_PROVIDER_KEY = 'openrouter'
const OPENROUTER_CREDITS_URL = 'https://openrouter.ai/api/v1/credits'
const OPENROUTER_KEY_URL = 'https://openrouter.ai/api/v1/auth/key'

function openRouterRecord(
	response: unknown,
): Record<string, unknown> | undefined {
	if (!isRecord(response)) return undefined
	if (!isRecord(response.data)) return undefined
	return response.data
}

async function pollOpenRouterQuotas(): Promise<OpenRouterQuota | undefined> {
	const token = readToken(OPENROUTER_PROVIDER_KEY)
	if (!token) return undefined
	const [creditsResponse, keyResponse] = await Promise.all([
		fetchJson(OPENROUTER_CREDITS_URL, token),
		fetchJson(OPENROUTER_KEY_URL, token),
	])
	const creditsRecord = openRouterRecord(creditsResponse)
	if (!creditsRecord) return undefined
	const totalCredits = creditsRecord.total_credits
	const totalUsage = creditsRecord.total_usage
	if (typeof totalCredits !== 'number') return undefined
	const balance = Math.max(
		0,
		totalCredits - (typeof totalUsage === 'number' ? totalUsage : 0),
	)
	const openRouterQuota: OpenRouterQuota = { balance }
	const keyRecord = openRouterRecord(keyResponse)
	const keyLimit = keyRecord?.limit
	const keyLimitRemaining = keyRecord?.limit_remaining
	if (typeof keyLimit === 'number' && typeof keyLimitRemaining === 'number') {
		openRouterQuota.weekly = {
			remaining: keyLimitRemaining,
			limit: keyLimit,
		}
	}
	return openRouterQuota
}

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

async function pollXaiQuotas(): Promise<XaiQuota | undefined> {
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

// ── OpenAI Codex - WHAM usage windows ─────────────────────
const OPENAI_PROVIDER_KEY = 'openai-codex'
const OPENAI_ACCOUNT_FIELD = 'accountId'
const OPENAI_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'

async function pollOpenaiQuotas(): Promise<OpenAIQuota | undefined> {
	const token = readToken(OPENAI_PROVIDER_KEY)
	if (!token) return undefined
	const accountId =
		readAuthField(OPENAI_PROVIDER_KEY, OPENAI_ACCOUNT_FIELD) ??
		chatgptAccountIdFromToken(token)
	if (!accountId) return undefined
	const usage = await fetchJsonWithHeaders(OPENAI_USAGE_URL, {
		Authorization: `Bearer ${token}`,
		'ChatGPT-Account-ID': accountId,
		originator: 'codex_cli_rs',
		Accept: 'application/json',
	})
	return parseOpenAIUsage(usage)
}

/** Poll every known billing backend in the classic footer request order. */
export async function pollQuotas(): Promise<QuotaCache> {
	const cache: QuotaCache = {}
	const kimi = await pollKimiQuotas()
	if (kimi) cache.kimi = kimi
	const openrouter = await pollOpenRouterQuotas()
	if (openrouter) cache.openrouter = openrouter
	const xai = await pollXaiQuotas()
	if (xai) cache.xai = xai
	const openai = await pollOpenaiQuotas()
	if (openai) cache.openai = openai
	return cache
}
