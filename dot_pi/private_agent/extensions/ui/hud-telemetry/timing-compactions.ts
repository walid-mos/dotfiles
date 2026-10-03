// Own compaction start/end pairing and capped rows; prompt lifetime stays outside.
import { MAX_TIMING_COMPACTIONS, addTimingUsage } from './timing-records.ts'
import { addMeasuredTiming, emptyTimingTotals } from './timing-totals.ts'

import type {
	PromptTimingRecord,
	TimingCompaction,
	TimingUsage,
} from './timing-records.ts'

type OpenCompaction = {
	startedAtMs: number
	reason: TimingCompaction['reason']
	willRetry: boolean
}

export type CompactionTimingSnapshot = Pick<
	PromptTimingRecord,
	'compactions' | 'compactionsOmitted' | 'compactionTotals'
>

export class TimingCompactions {
	private open: OpenCompaction[] = []
	private completed: TimingCompaction[] = []
	private omitted = 0
	private totals = emptyTimingTotals()

	start(compaction: OpenCompaction): void {
		this.open.push(compaction)
	}

	end(
		outcome: TimingCompaction['outcome'],
		usage: TimingUsage | undefined,
		nowMs: number,
	): TimingCompaction | undefined {
		const open = this.open.shift()
		if (!open) return undefined
		const compaction: TimingCompaction = {
			atMs: open.startedAtMs,
			durationMs: Math.max(0, nowMs - open.startedAtMs),
			reason: open.reason,
			outcome,
			willRetry: open.willRetry,
		}
		if (usage) compaction.usage = usage
		this.totals = addMeasuredTiming(this.totals, compaction.durationMs)
		if (usage) this.totals.usage = addTimingUsage(this.totals.usage, usage)
		if (this.completed.length < MAX_TIMING_COMPACTIONS)
			this.completed.push(compaction)
		else this.omitted += 1
		return compaction
	}

	snapshot(): CompactionTimingSnapshot {
		return {
			compactions: [...this.completed],
			compactionTotals: this.totals,
			compactionsOmitted: this.omitted,
		}
	}
}
