// Coordinate one prompt's timing record; each interval collector owns its pairing and counts.
import { drainHookTimings } from '#lib/telemetry/hook-timing.ts'

import { bookTimedHooks, buildRecord, emptyBuilder } from './timing-book.ts'
import { TimingCompactions } from './timing-compactions.ts'
import { promptExcerpt } from './timing-records.ts'
import { TimingRequests } from './timing-requests.ts'

import type { AssistantMessage, ToolResultMessage } from '@earendil-works/pi-ai'
import type { RecordBuilder } from './timing-book.ts'
import type {
	PromptTimingRecord,
	TimingCompaction,
	TimingOutcome,
	TimingUsage,
} from './timing-records.ts'

export class TimingCollector {
	private builder: RecordBuilder | undefined
	private requests = new TimingRequests()
	private compactions = new TimingCompactions()
	private isStandaloneCompaction = false
	private lastPrompt = ''

	/** New session or replacement: drop the in-memory prompt window entirely. */
	reset(): void {
		this.isStandaloneCompaction = false
		this.lastPrompt = ''
		this.builder = undefined
		this.requests = new TimingRequests()
		this.compactions = new TimingCompactions()
	}

	/** Idle human input closes an interrupted record before opening the next. */
	onHumanInput(
		promptText: string,
		isIdle: boolean,
		nowMs: number,
	): PromptTimingRecord | undefined {
		if (!isIdle) return undefined
		const closed = this.settle(nowMs)
		this.openRecord(promptText, nowMs)
		return closed
	}

	onBeforeAgentStart(promptText: string, nowMs: number): void {
		if (!this.builder) {
			this.openRecord(promptText, nowMs)
			return
		}
		if (!this.builder.prompt)
			this.builder.prompt = promptExcerpt(promptText)
	}

	onCacheWarmingDecision(decision: { action?: 'warm' | 'stop' }): void {
		if (this.builder) this.requests.recordWarmDecision(decision)
	}

	onProviderRequestOpen(nowMs: number): void {
		this.ensureActivity(nowMs)
		this.requests.open(nowMs)
	}

	onProviderResponse(nowMs: number): void {
		this.requests.respond(nowMs)
	}

	onAssistantMessageStart(message: AssistantMessage, nowMs: number): void {
		this.ensureActivity(nowMs)
		this.requests.startMessage(message, nowMs)
	}

	onAssistantDelta(message: AssistantMessage, nowMs: number): void {
		this.requests.recordDelta(message, nowMs)
	}

	onAssistantMessageEnd(message: AssistantMessage, nowMs: number): void {
		if (this.builder) this.requests.endMessage(message, nowMs)
	}

	onTurnToolResults(toolResults: readonly ToolResultMessage[]): void {
		this.builder?.tools.addUsages(toolResults)
	}

	onToolExecutionStart(
		toolCallId: string,
		toolName: string,
		nowMs: number,
	): void {
		this.ensureActivity(nowMs)
		this.builder?.tools.start(toolCallId, toolName, nowMs)
	}

	onToolExecutionEnd(toolCallId: string, nowMs: number): void {
		this.builder?.tools.end(toolCallId, nowMs)
	}

	onCompactionStart(
		reason: TimingCompaction['reason'],
		willRetry: boolean,
		nowMs: number,
	): void {
		if (!this.builder) {
			this.openRecord('', nowMs)
			this.isStandaloneCompaction = true
		}
		this.compactions.start({ reason, willRetry, startedAtMs: nowMs })
	}

	onCompactionEnd(
		outcome: TimingCompaction['outcome'],
		usage: TimingUsage | undefined,
		nowMs: number,
	): PromptTimingRecord | undefined {
		const completed = this.compactions.end(outcome, usage, nowMs)
		if (!this.builder || !completed || !this.isStandaloneCompaction)
			return undefined
		return this.settle(nowMs, outcome === 'failed' ? 'error' : outcome)
	}

	/** A native async wake need not emit input or before_agent_start. */
	ensureActivity(nowMs: number): void {
		if (!this.builder)
			this.openRecord(this.lastPrompt || 'Resumed activity', nowMs)
		this.isStandaloneCompaction = false
	}

	/** Current measurements for /latency, without closing or persisting the interval. */
	snapshot(nowMs: number): PromptTimingRecord | undefined {
		if (!this.builder) return undefined
		this.builder = { ...this.builder, ...this.collectHooks(this.builder) }
		return buildRecord({
			builder: this.builder,
			endedAtMs: nowMs,
			requests: this.requests.snapshot(),
			compactions: this.compactions.snapshot(),
			outcome: 'active',
		})
	}

	/** Drain hook reports and freeze the independently collected intervals. */
	settle(
		nowMs: number,
		outcome?: TimingOutcome,
	): PromptTimingRecord | undefined {
		const { builder } = this
		if (!builder) return undefined
		const record = buildRecord({
			builder: { ...builder, ...this.collectHooks(builder) },
			endedAtMs: nowMs,
			requests: this.requests.snapshot(),
			compactions: this.compactions.snapshot(),
			outcome,
		})
		this.reset()
		this.lastPrompt = builder.prompt
		return record
	}

	private openRecord(promptText: string, nowMs: number): void {
		const builder = emptyBuilder(nowMs, promptText)
		this.builder = { ...builder, ...this.collectHooks(builder) }
	}

	private collectHooks(
		builder: RecordBuilder,
	): Pick<RecordBuilder, 'hooks' | 'hooksDropped' | 'hookTotals'> {
		const drained = drainHookTimings()
		const booked = bookTimedHooks(drained.reports, builder)
		return {
			hooks: booked.hooks,
			hooksDropped: booked.hooksDropped + drained.dropped,
			hookTotals: {
				count: builder.hookTotals.count + drained.count,
				measured: builder.hookTotals.measured + drained.count,
				durationMs: builder.hookTotals.durationMs + drained.durationMs,
			},
		}
	}
}
