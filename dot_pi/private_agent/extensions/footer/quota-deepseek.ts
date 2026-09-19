// DeepSeek prepaid balance: /user/balance reports the remaining credit per
// currency, with amounts as decimal strings.

import { isRecord, finiteNumber } from './json.ts'
import { fetchJson, readToken } from './quotas.ts'

import type { DeepseekQuota } from './quotas.ts'

const DEEPSEEK_PROVIDER_KEY = 'deepseek'
const DEEPSEEK_BALANCE_URL = 'https://api.deepseek.com/user/balance'

/** DeepSeek reports one balance row per currency; the top-up account is first. */
const FIRST_BALANCE_INDEX = 0

/** Currency codes we can label; anything else prints its code verbatim. */
const CURRENCY_SYMBOLS: Record<string, string> = {
	CNY: '\u00a5',
	USD: '$',
}

/** DeepSeek credit for the footer, or undefined when nothing is configured. */
export async function pollDeepseekQuotas(): Promise<DeepseekQuota | undefined> {
	const token = readToken(DEEPSEEK_PROVIDER_KEY)
	if (!token) return undefined
	return parseDeepseekBalance(await fetchJson(DEEPSEEK_BALANCE_URL, token))
}

/** Parse `/user/balance`; undefined when no usable balance row is present. */
export function parseDeepseekBalance(
	response: unknown,
): DeepseekQuota | undefined {
	if (!isRecord(response)) return undefined
	const infos = response.balance_infos
	if (!Array.isArray(infos)) return undefined
	const row = infos[FIRST_BALANCE_INDEX]
	if (!isRecord(row)) return undefined
	const balance = finiteNumber(row.total_balance)
	if (!Number.isFinite(balance)) return undefined
	const currency = typeof row.currency === 'string' ? row.currency : 'USD'
	return { balance: Math.max(0, balance), currency }
}

/** Currency symbol for the strip, falling back to the code itself. */
export function currencySymbol(currency: string): string {
	return CURRENCY_SYMBOLS[currency.toUpperCase()] ?? `${currency} `
}

/**
 * Rough yuan-per-dollar rate. Only the balance colour ramp is thresholded in
 * USD; the printed amount always stays in the currency DeepSeek reported.
 */
const CNY_PER_USD = 7

/** Balance expressed in USD, for the shared colour ramp only. */
export function deepseekBalanceUsd(quota: DeepseekQuota): number {
	return quota.currency.toUpperCase() === 'CNY'
		? quota.balance / CNY_PER_USD
		: quota.balance
}
