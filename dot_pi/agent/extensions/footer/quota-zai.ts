// Z.AI (GLM Coding Plan) quota: the monitor endpoint behind the z.ai dashboard.
// Polling flow for one backend; orchestration lives in poll-quotas.ts and
// rendering in render-quota.ts.

import { finiteNumber, finiteOr, isRecord } from './json.ts'
import { fetchJson, readToken } from './quotas.ts'

/** One rolling credit window (5-hour or weekly), as the API reports it. */
export type ZaiWindow = {
	used: number
	limit: number
	remaining: number
	reset: string
}

/** Z.AI quota for the footer: plan badge plus the two credit windows. */
export type ZaiQuota = {
	plan?: string
	fiveHour: ZaiWindow
	weekly: ZaiWindow
}

const ZAI_PROVIDER_KEY = 'zai'
const ZAI_QUOTA_URL = 'https://api.z.ai/api/monitor/usage/quota/limit'

// Limit entries classify as credits (current accounts) or tokens (legacy
// accounts); both share the same window shape.
const ZAI_LIMIT_TYPES = new Set(['CREDIT_LIMIT', 'TOKENS_LIMIT'])

const HOURS_PER_DAY = 24
const MINUTES_PER_HOUR = 60
const MINUTES_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR
const DAYS_PER_WEEK = 7
const MINUTES_PER_WEEK = DAYS_PER_WEEK * MINUTES_PER_DAY

/** Unit codes → minutes per unit (1=day, 3=hour, 5=minute, 6=week). */
const ZAI_UNIT_MINUTES: Record<number, number> = {
	1: MINUTES_PER_DAY,
	3: MINUTES_PER_HOUR,
	5: 1,
	6: MINUTES_PER_WEEK,
}

type ParsedZaiLimit = ZaiWindow & { minutes: number }

/** Minutes a limit entry covers; entries without a period cannot be ranked. */
function zaiWindowMinutes(entry: Record<string, unknown>): number {
	const unit = finiteNumber(entry.unit)
	const number = finiteNumber(entry.number)
	const unitMinutes = ZAI_UNIT_MINUTES[unit]
	if (!unitMinutes || !Number.isFinite(number)) return Number.NaN
	return number * unitMinutes
}

/**
 * Parse one limit entry. Field names are misleading: `usage` is the window
 * total, `currentValue` the consumed credits, `remaining` what is left, and
 * `nextResetTime` an epoch-ms stamp.
 */
function parseZaiLimit(entry: unknown): ParsedZaiLimit | undefined {
	if (!isRecord(entry)) return undefined
	if (typeof entry.type !== 'string' || !ZAI_LIMIT_TYPES.has(entry.type)) {
		return undefined
	}
	const limit = finiteNumber(entry.usage)
	if (!Number.isFinite(limit) || limit <= 0) return undefined
	const minutes = zaiWindowMinutes(entry)
	if (!Number.isFinite(minutes)) return undefined
	const remaining = Math.max(0, finiteOr(entry.remaining, limit))
	const used = Math.max(0, finiteOr(entry.currentValue, limit - remaining))
	const resetMs = finiteNumber(entry.nextResetTime)
	return {
		used,
		limit,
		remaining,
		// nextResetTime is already epoch milliseconds - no seconds conversion.
		reset:
			Number.isFinite(resetMs) && resetMs > 0
				? new Date(resetMs).toISOString()
				: '',
		minutes,
	}
}

/** Dashboard level code ('lite') as a display badge ('Lite'). */
function zaiPlanBadge(level: unknown): string | undefined {
	if (typeof level !== 'string' || !level.length) return undefined
	return `${level.charAt(0).toUpperCase()}${level.slice(1)}`
}

/** Parse `/api/monitor/usage/quota/limit`; undefined when no window parses. */
export function parseZaiQuota(response: unknown): ZaiQuota | undefined {
	if (!isRecord(response) || response.success !== true) return undefined
	const payload = response.data
	if (!isRecord(payload) || !Array.isArray(payload.limits)) return undefined
	const plan = zaiPlanBadge(payload.level)
	const windows = payload.limits
		.map(parseZaiLimit)
		.filter((parsed): parsed is ParsedZaiLimit => Boolean(parsed))
		.toSorted((first, second) => first.minutes - second.minutes)
	const [fiveHour] = windows
	if (!fiveHour) return undefined
	const weekly = windows.length > 1 ? windows.at(-1) : undefined
	const quota: ZaiQuota = {
		fiveHour,
		// Show 5h alone rather than echo it twice.
		weekly: weekly ?? { used: 0, limit: 0, remaining: 0, reset: '' },
	}
	if (plan) quota.plan = plan
	return quota
}

/** Z.AI credit windows for the footer, or undefined when nothing is configured. */
export async function pollZaiQuotas(): Promise<ZaiQuota | undefined> {
	const token = readToken(ZAI_PROVIDER_KEY)
	if (!token) return undefined
	return parseZaiQuota(await fetchJson(ZAI_QUOTA_URL, token))
}
