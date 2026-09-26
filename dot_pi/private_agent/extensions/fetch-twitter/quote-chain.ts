/** Quote chains: a status plus its nested quotes, capped in depth. */

import { fxtwitterRecord } from './fx-payload.ts'

import type { FxTwitterRecord } from './fx-payload.ts'

export const MAX_QUOTE_DEPTH = 3

export type QuoteChainEntry = {
	readonly status: FxTwitterRecord
	readonly depth: number
}

/**
 * The quote chain of `rootStatus`: the status itself at depth 0, then each
 * nested quote. Deeper than MAX_QUOTE_DEPTH is dropped.
 */
export function quoteChainStatuses(rootStatus: unknown): QuoteChainEntry[] {
	const entries: QuoteChainEntry[] = []
	let currentStatus: unknown = rootStatus
	for (let depth = 0; depth <= MAX_QUOTE_DEPTH; depth += 1) {
		const status = fxtwitterRecord(currentStatus)
		if (!status) break
		entries.push({ depth, status })
		currentStatus = status.quote
	}
	return entries
}

/** Label prefix for a chain entry at `depth` ('', 'quoted ', 'quoted 2 ', …). */
export function quoteDepthPrefix(depth: number): string {
	if (depth === 0) return ''
	return depth === 1 ? 'quoted ' : `quoted ${depth} `
}
