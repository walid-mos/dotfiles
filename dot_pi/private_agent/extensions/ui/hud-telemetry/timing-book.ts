// Assemble a prompt record from independently collected request, tool and compaction timings.
// Clock reads and persistence stay outside this module.
import { MAX_TIMING_HOOKS, promptExcerpt } from './timing-records.ts'
import { TimingTools } from './timing-tools.ts'
import { emptyTimingTotals } from './timing-totals.ts'

import type { HookTimingReport } from '#lib/telemetry/hook-timing.ts'
import type { CompactionTimingSnapshot } from './timing-compactions.ts'
import type {
	PromptTimingRecord,
	TimingHook,
	TimingOutcome,
} from './timing-records.ts'
import type { RequestTimingSnapshot } from './timing-requests.ts'
import type { TimingTotals } from './timing-totals.ts'

export type RecordBuilder = {
	prompt: string
	startedAtMs: number
	tools: TimingTools
	hooks: TimingHook[]
	hookTotals: TimingTotals
	hooksDropped: number
}

export function emptyBuilder(
	startedAtMs: number,
	promptText: string,
): RecordBuilder {
	return {
		prompt: promptExcerpt(promptText),
		startedAtMs,
		tools: new TimingTools(),
		hooks: [],
		hookTotals: emptyTimingTotals(),
		hooksDropped: 0,
	}
}

/** Build the record; everything it stores was measured at Pi's boundaries. */
export function buildRecord(input: {
	builder: RecordBuilder
	endedAtMs: number
	requests: RequestTimingSnapshot
	compactions: CompactionTimingSnapshot
	outcome?: TimingOutcome | undefined
}): PromptTimingRecord {
	const { builder, endedAtMs, requests, compactions, outcome } = input
	return {
		prompt: builder.prompt,
		startedAtMs: builder.startedAtMs,
		endedAtMs,
		outcome: outcome ?? requests.outcome,
		requests: requests.requests,
		requestTotals: requests.requestTotals,
		requestsOmitted: requests.requestsOmitted,
		unpairedRequests: requests.unpairedRequests,
		warmRequests: requests.warmRequests,
		tools: builder.tools.snapshot(endedAtMs),
		compactions: compactions.compactions,
		compactionTotals: compactions.compactionTotals,
		compactionsOmitted: compactions.compactionsOmitted,
		hooks: builder.hooks,
		hookTotals: builder.hookTotals,
		hooksDropped: builder.hooksDropped,
	}
}

/** Book measured hook reports into the builder, capped, oldest-first. */
export function bookTimedHooks(
	reports: readonly HookTimingReport[],
	booked: { hooks: TimingHook[]; hooksDropped: number },
): { hooks: TimingHook[]; hooksDropped: number } {
	const timedHooks = [...booked.hooks]
	let { hooksDropped } = booked
	for (const report of reports) {
		if (timedHooks.length >= MAX_TIMING_HOOKS) {
			hooksDropped += 1
			continue
		}
		timedHooks.push({
			atMs: report.startedAtMs,
			durationMs: Math.max(0, report.endedAtMs - report.startedAtMs),
			event: report.event,
			name: report.name,
		})
	}
	return { hooks: timedHooks, hooksDropped }
}
