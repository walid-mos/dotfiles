// Active-branch token totals for the footer, derived from session entries.
// Pure: no state, no IO. Exported for tests.

import { ratesAt, usesDeepseekTariff } from './tariff-deepseek.ts'

import type { AssistantMessage } from '@earendil-works/pi-ai'
import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import type { DeepseekTariff } from './tariff-deepseek.ts'

export type TokenTotals = { input: number; output: number; cost: number }

/**
 * Cost of one assistant turn. pi prices every turn at the model's single stored
 * rate; a DeepSeek Flash turn is priced at the tariff of its own instant, so a
 * session spanning peak and off-peak hours totals both tiers.
 */
function turnCost(
	message: AssistantMessage,
	at: Date,
	tariff: DeepseekTariff | null,
): number {
	if (!tariff || !usesDeepseekTariff(message.provider, message.model)) {
		return message.usage.cost.total
	}
	const rates = ratesAt(tariff, at)
	const { usage } = message
	return (
		usage.input * rates.input +
		usage.output * rates.output +
		usage.cacheRead * rates.cacheRead
	)
}

/** Sum token usage over every assistant turn of the active branch. */
export function tokenTotals(
	branchEntries: readonly SessionEntry[],
	tariff: DeepseekTariff | null = null,
): TokenTotals {
	let input = 0
	let output = 0
	let cost = 0
	for (const entry of branchEntries) {
		if (entry.type !== 'message') continue
		if (entry.message.role !== 'assistant') continue
		const { usage } = entry.message
		input += usage.input
		output += usage.output
		cost += turnCost(entry.message, new Date(entry.timestamp), tariff)
	}
	return { input, output, cost }
}
