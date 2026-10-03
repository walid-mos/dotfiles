// Runinfra workspace credit balance (the $ remaining), in USD.
// Authentication uses Pi's model registry, including models.json commands.

import { isRecord } from './json.ts'
import { fetchJson } from './quotas.ts'

import type { ModelRegistry } from '@earendil-works/pi-coding-agent'

export type RuninfraQuota = {
	balance: number
}

const RUNINFRA_PROVIDER = 'runinfra'
const RUNINFRA_CREDITS_URL = 'https://api.runinfra.ai/v1/credits'
const CENTS_PER_DOLLAR = 100

/** Reject missing counters rather than displaying invented zero usage. */
export function parseRuninfraCredits(
	response: unknown,
): RuninfraQuota | undefined {
	if (
		!isRecord(response) ||
		response.object !== 'credits' ||
		response.currency !== 'usd'
	)
		return undefined
	const { balance_cents: balance } = response
	if (typeof balance !== 'number' || !Number.isSafeInteger(balance))
		return undefined
	// Holds are already deducted; retain negative balances when the account owes.
	return { balance: balance / CENTS_PER_DOLLAR }
}

/** Missing credentials or unavailable billing leaves the quota strip unknown. */
export async function pollRuninfraQuotas(
	registry: Pick<ModelRegistry, 'getApiKeyForProvider'>,
): Promise<RuninfraQuota | undefined> {
	try {
		const token = await registry.getApiKeyForProvider(RUNINFRA_PROVIDER)
		if (!token) return undefined
		return parseRuninfraCredits(
			await fetchJson(RUNINFRA_CREDITS_URL, token),
		)
	} catch {
		// Decorative polling must not interrupt other providers or the session.
		return undefined
	}
}
