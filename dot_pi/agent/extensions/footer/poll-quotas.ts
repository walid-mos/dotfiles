// Quota polling: one fetch-and-parse flow per billing backend, orchestrated
// sequentially (same request order as the original footer implementation).
// Rendering lives in render-quota.ts.

import { pollIncoQuotas } from './inco-session.ts'
import { isRecord } from './json.ts'
import { pollNebiusQuotas } from './nebius-session.ts'
import { pollDeepseekQuotas } from './quota-deepseek.ts'
import { parseOpenAIUsage, chatgptAccountIdFromToken } from './quota-openai.ts'
import { pollXaiQuotas } from './quota-xai.ts'
import {
	fetchJson,
	fetchJsonWithHeaders,
	parseKimiWindow,
	readToken,
} from './quotas.ts'
import { readAuthField } from './quotas.ts'

import type {
	KimiQuota,
	OpenAIQuota,
	OpenRouterQuota,
	QuotaCache,
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
	const deepseek = await pollDeepseekQuotas()
	if (deepseek) cache.deepseek = deepseek
	const nebius = await pollNebiusQuotas()
	if (nebius) cache.nebius = nebius
	const inco = await pollIncoQuotas()
	if (inco) cache.inco = inco
	return cache
}
