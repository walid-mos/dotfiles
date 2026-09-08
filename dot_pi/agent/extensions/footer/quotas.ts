// Provider quota data: auth reads, HTTP access and response parsers for the
// supported billing backends. Polling orchestration lives in poll-quotas.ts,
// rendering in render-quota.ts.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'

import { isRecord, finiteNumber, finiteOr, FIELD_NAN } from './json.ts'

export const AUTH_PATH = `${homedir()}/.pi/agent/auth.json`

/** HTTP fetch budget: quota polling is decorative, never hang the footer. */
const FETCH_TIMEOUT_MS = 8000

/** Time conversion for epoch-second server stamps. */
export const MS_PER_SECOND = 1000

export type KimiWindow = {
	used: number
	limit: number
	remaining: number
	reset: string
}

export type KimiQuota = {
	fiveHour: KimiWindow
	weekly: KimiWindow
}

export type OpenRouterQuota = {
	balance: number
	// Per-key weekly spend cap, if set
	weekly?: { remaining: number; limit: number }
}

export type XaiQuota = {
	tier?: string
	// Legacy GrokBuildBillingConfig fields (deprecated, old accounts only)
	monthly?: { used: number; limit: number; reset: string }
	// Primary pool gauge - creditUsagePercent over a weekly OR monthly period
	pool?: { usedPercent: number; reset: string; label: 'hebdo' | 'mois' }
	prepaidBalance?: number
}

export type UsageWindow = {
	usedPercent: number
	reset: string
	label: string
}

export type OpenAIQuota = {
	plan?: string
	windows: UsageWindow[]
	credits?: number
	resets?: number
}

export type QuotaCache = {
	kimi?: KimiQuota
	openrouter?: OpenRouterQuota
	xai?: XaiQuota
	openai?: OpenAIQuota
	error?: boolean
}

/** xAI pool gauge labels (fr denoting the rolling period). */
export const XAI_POOL_LABELS = {
	weekly: 'hebdo',
	monthly: 'mois',
} as const

export function readAuthRecord(
	provider: string,
): Record<string, unknown> | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(AUTH_PATH, 'utf8'))
		if (!isRecord(parsed)) return undefined
		const entry = parsed[provider]
		if (!isRecord(entry)) return undefined
		return entry
	} catch {
		return undefined
	}
}

export function readAuthField(
	provider: string,
	field: string,
): string | undefined {
	const recordEntry = readAuthRecord(provider)?.[field]

	if (typeof recordEntry !== 'string' || !recordEntry.length) return undefined
	return recordEntry
}

export function readToken(provider: string): string | undefined {
	return readAuthField(provider, 'access')
}

export async function fetchJson(url: string, token: string): Promise<unknown> {
	try {
		const response = await fetch(url, {
			headers: { Authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		})
		if (!response.ok) return undefined
		return await response.json()
	} catch {
		return undefined
	}
}

export async function fetchJsonWithHeaders(
	url: string,
	headers: Record<string, string>,
): Promise<unknown> {
	try {
		const response = await fetch(url, {
			headers,
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		})
		if (!response.ok) return undefined
		return await response.json()
	} catch {
		return undefined
	}
}

const KIMI_RESET_FIELDS = ['resetTime', 'reset_time', 'resetAt'] as const

/** First reset stamp among the Kimi field aliases (or parser fallback). */
function kimiResetText(
	detail: Record<string, unknown>,
	resetFallback?: unknown,
): string {
	const candidates = [
		...KIMI_RESET_FIELDS.map(field => detail[field]),
		resetFallback,
	]
	for (const candidate of candidates) {
		if (typeof candidate === 'string') return candidate
	}
	return ''
}

/** Remainder in the window: server value, else limit-minus-used. */
function kimiRemaining(
	detail: Record<string, unknown>,
	limit: number,
	used: number,
): number {
	const remaining = finiteNumber(detail.remaining)
	if (Number.isFinite(remaining)) return remaining
	if (!Number.isFinite(limit)) return FIELD_NAN
	return Math.max(0, limit - used)
}

export function parseKimiWindow(
	detail: unknown,
	resetFallback?: unknown,
): KimiWindow | undefined {
	if (!isRecord(detail)) return undefined
	const used = finiteOr(detail.used, 0)
	const limit = finiteNumber(detail.limit)
	const remaining = kimiRemaining(detail, limit, used)
	const hasWindowShape = Number.isFinite(limit) && Number.isFinite(remaining)
	if (!hasWindowShape) return undefined
	return {
		used,
		limit,
		remaining,
		reset: kimiResetText(detail, resetFallback),
	}
}
