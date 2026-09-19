// OpenAI Codex (ChatGPT subscription) usage parsing: WHAM windows,
// plan labels and the ChatGPT account id carried in OAuth tokens.

import { PERCENT_SCALE, PERCENT_FLOOR } from './gauge.ts'
import { isRecord, finiteNumber, finiteOr } from './json.ts'
import { MS_PER_SECOND } from './quotas.ts'

import type { UsageWindow, OpenAIQuota } from './quotas.ts'

const OPENAI_PLAN_LABELS: Record<string, string> = {
	guest: 'guest',
	free: 'free',
	go: 'go',
	plus: 'plus',
	pro: 'pro',
	prolite: 'pro lite',
	free_workspace: 'workspace',
	team: 'team',
	business: 'business',
	enterprise: 'enterprise',
	edu: 'edu',
	education: 'edu',
	quorum: 'quorum',
	k12: 'k12',
	unknown: 'unknown',
}

export function openaiPlanLabel(planType: unknown): string | undefined {
	if (typeof planType !== 'string' || !planType.length) return undefined
	return OPENAI_PLAN_LABELS[planType] ?? planType
}

// Usage-window labels derive from the limit span in seconds
const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24
const SECONDS_PER_HOUR = MINUTES_PER_HOUR * SECONDS_PER_MINUTE
const SECONDS_PER_DAY = HOURS_PER_DAY * SECONDS_PER_HOUR
const WEEK_LABEL_MIN_DAYS = 6
const FIVE_HOUR_WINDOW_HOURS = 4.5
const HALF_HOUR_WINDOW_MINUTES = 45
const WEEK_LABEL_MIN_SECONDS = WEEK_LABEL_MIN_DAYS * SECONDS_PER_DAY
const FIVE_HOUR_LABEL_MIN_SECONDS = FIVE_HOUR_WINDOW_HOURS * SECONDS_PER_HOUR
const HALF_HOUR_LABEL_MIN_SECONDS =
	HALF_HOUR_WINDOW_MINUTES * SECONDS_PER_MINUTE

/** Labels stay short because the quota strip is dense. */
const WEEK_WINDOW_LABEL = 'sem'
const FIVE_HOUR_WINDOW_LABEL = '5h'
const MINUTE_WINDOW_LABEL = 'min'

/**
 * Usage-window label from the limit span: a week prints `sem`, the five-hour
 * bucket prints `5h`, multi-hour spans print `Nh`, shorter spans `Nmin`.
 */
export function usageWindowLabel(limitWindowSeconds: number): string {
	if (limitWindowSeconds >= WEEK_LABEL_MIN_SECONDS) return WEEK_WINDOW_LABEL
	if (limitWindowSeconds >= FIVE_HOUR_LABEL_MIN_SECONDS) {
		return FIVE_HOUR_WINDOW_LABEL
	}
	if (limitWindowSeconds >= HALF_HOUR_LABEL_MIN_SECONDS) {
		return `${Math.round(limitWindowSeconds / SECONDS_PER_HOUR)}h`
	}
	return `${Math.max(1, Math.round(limitWindowSeconds / SECONDS_PER_MINUTE))}${MINUTE_WINDOW_LABEL}`
}

/** Base64url chunk size used by the JWT payload padding step. */
const JWT_BASE64_CHUNK = 4
const OPENAI_AUTH_CLAIM = 'https://api.openai.com/auth'
const OPENAI_ACCOUNT_CLAIM = 'chatgpt_account_id'

/** Extract the ChatGPT account id embedded in a Codex OAuth access token. */
export function chatgptAccountIdFromToken(token: string): string | undefined {
	const [, payload] = token.split('.')
	if (!payload) return undefined
	try {
		const unpadded = payload
			.replace(/-/g, '+')
			.replace(/_/g, '/')
			.padEnd(
				Math.ceil(payload.length / JWT_BASE64_CHUNK) * JWT_BASE64_CHUNK,
				'=',
			)
		const parsed: unknown = JSON.parse(
			Buffer.from(unpadded, 'base64').toString('utf8'),
		)
		if (!isRecord(parsed)) return undefined
		const oauth = parsed[OPENAI_AUTH_CLAIM]
		if (!isRecord(oauth)) return undefined
		const accountId = oauth[OPENAI_ACCOUNT_CLAIM]
		if (typeof accountId !== 'string' || !accountId.length) return undefined
		return accountId
	} catch {
		return undefined
	}
}

function parseUsageWindow(raw: unknown): UsageWindow | undefined {
	if (!isRecord(raw)) return undefined
	const usedPercent = finiteNumber(raw.used_percent)
	const windowSeconds = finiteNumber(raw.limit_window_seconds)
	// Absent server fields read as NaN; zero percent and idle windows are real data
	if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) return undefined
	if (!Number.isFinite(usedPercent)) return undefined
	const resetAt = finiteNumber(raw.reset_at)
	const reset = Number.isFinite(resetAt)
		? new Date(resetAt * MS_PER_SECOND).toISOString()
		: ''
	return {
		usedPercent: Math.min(
			PERCENT_SCALE,
			Math.max(PERCENT_FLOOR, usedPercent),
		),
		reset,
		label: usageWindowLabel(windowSeconds),
	}
}

const OPENAI_RATE_LIMIT_WINDOW_FIELDS = [
	'primary_window',
	'secondary_window',
] as const

/** WHAM usage response → OpenAIQuota; undefined when nothing is usable. */
export function parseOpenAIUsage(raw: unknown): OpenAIQuota | undefined {
	if (!isRecord(raw)) return undefined
	const rateLimit = isRecord(raw.rate_limit) ? raw.rate_limit : undefined
	const windows = OPENAI_RATE_LIMIT_WINDOW_FIELDS.flatMap(field => {
		const parsed = parseUsageWindow(rateLimit?.[field])
		return parsed ? [parsed] : []
	})
	const creditsRecord = isRecord(raw.credits) ? raw.credits : undefined
	const credits =
		creditsRecord?.has_credits === true
			? finiteOr(creditsRecord.balance, 0)
			: 0
	const resetsRecord = isRecord(raw.rate_limit_reset_credits)
		? raw.rate_limit_reset_credits
		: undefined
	const resets = finiteOr(resetsRecord?.available_count, 0)
	const plan = openaiPlanLabel(raw.plan_type)
	const hasUsageSignal =
		Boolean(plan) || windows.length > 0 || credits > 0 || resets > 0
	if (!hasUsageSignal) return undefined
	const quota: OpenAIQuota = { windows }
	if (plan) quota.plan = plan
	if (credits > 0) quota.credits = credits
	if (resets > 0) quota.resets = resets
	return quota
}
