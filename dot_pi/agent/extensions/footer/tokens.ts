// Active-branch token totals for the footer, derived from session entries.
// Pure: no state, no IO. Exported for tests.

import type { SessionEntry } from '@earendil-works/pi-coding-agent'

export type TokenTotals = { input: number; output: number; cost: number }

/** Sum token usage over every assistant turn of the active branch. */
export function tokenTotals(
	branchEntries: readonly SessionEntry[],
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
		cost += usage.cost.total
	}
	return { input, output, cost }
}
