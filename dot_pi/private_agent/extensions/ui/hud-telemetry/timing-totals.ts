/** Complete aggregates, independent of detail-row retention. */
import { Type } from 'typebox'
import { Value } from 'typebox/value'

import type { Static } from 'typebox'
import type { TimingUsage } from './timing-records.ts'

const usageSchema = Type.Object({
	input: Type.Integer({ minimum: 0 }),
	output: Type.Integer({ minimum: 0 }),
	cacheRead: Type.Integer({ minimum: 0 }),
	cacheWrite: Type.Integer({ minimum: 0 }),
})

export function readTimingUsage(candidate: unknown): TimingUsage | undefined {
	if (!Value.Check(usageSchema, candidate)) return undefined
	return candidate
}
const totalsSchema = Type.Object({
	count: Type.Integer({ minimum: 0 }),
	measured: Type.Integer({ minimum: 0 }),
	durationMs: Type.Number({ minimum: 0 }),
	usage: Type.Optional(usageSchema),
})
export type TimingTotals = Static<typeof totalsSchema>

export function emptyTimingTotals(): TimingTotals {
	return { count: 0, measured: 0, durationMs: 0 }
}

export function readTimingTotals(candidate: unknown): TimingTotals | undefined {
	if (!Value.Check(totalsSchema, candidate)) return undefined
	return candidate
}

export function addMeasuredTiming(
	totals: TimingTotals,
	durationMs: number,
): TimingTotals {
	return {
		...totals,
		count: totals.count + 1,
		measured: totals.measured + 1,
		durationMs: totals.durationMs + durationMs,
	}
}
