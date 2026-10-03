// Persist prompt timing records at Pi's lifecycle boundaries and register /latency.
import {
	CHECKPOINT_STARTED_EVENT,
	CHECKPOINT_FINISHED_EVENT,
	isCheckpointStarted,
	isCheckpointFinished,
} from '#lib/context-budget/events.ts'

import { TimingCollector } from './timing-collector.ts'
import { PROMPT_TIMING_ENTRY, timingUsageOf } from './timing-records.ts'
import { summarizeTimings } from './timing-view.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { PromptTimingRecord, TimingUsage } from './timing-records.ts'

const nowMs = (): number => Date.now()

function persistTimings(pi: ExtensionAPI, record: PromptTimingRecord): void {
	pi.appendEntry(PROMPT_TIMING_ENTRY, record)
}

function wireCompactionTimings(
	pi: ExtensionAPI,
	collector: TimingCollector,
): void {
	pi.events.on(CHECKPOINT_STARTED_EVENT, event => {
		if (!isCheckpointStarted(event)) return
		collector.onCompactionStart(
			event.reason,
			event.willRetry,
			event.startedAtMs,
		)
	})
	// Manual success waits for Pi's history write. Owned failures close here:
	// Pi reports our refusal as an abort even when its signal was not aborted.
	pi.events.on(CHECKPOINT_FINISHED_EVENT, event => {
		if (!isCheckpointFinished(event)) return
		if (event.reason !== 'automatic' && event.outcome === 'completed')
			return
		const usage = event.usage ? timingUsageOf(event.usage) : undefined
		const closed = collector.onCompactionEnd(
			event.outcome,
			usage,
			event.endedAtMs,
		)
		if (closed) persistTimings(pi, closed)
	})
	pi.on('session_compact', event => {
		const usage: TimingUsage | undefined = event.compactionEntry.usage
			? timingUsageOf(event.compactionEntry.usage)
			: undefined
		const closed = collector.onCompactionEnd('completed', usage, nowMs())
		if (closed) persistTimings(pi, closed)
	})
	pi.on('session_compact_failed', event => {
		const closed = collector.onCompactionEnd(
			event.aborted ? 'aborted' : 'failed',
			undefined,
			nowMs(),
		)
		if (closed) persistTimings(pi, closed)
	})
}

function wireTimingCollector(
	pi: ExtensionAPI,
	collector: TimingCollector,
): void {
	const store = (settled: PromptTimingRecord | undefined): void => {
		if (settled) persistTimings(pi, settled)
	}
	pi.on('session_start', () => collector.reset())
	pi.on('session_tree', () => collector.reset())
	pi.on('agent_start', () => collector.ensureActivity(nowMs()))
	pi.on('input', event => {
		const closed = collector.onHumanInput(
			event.text,
			event.source !== 'extension' && !event.streamingBehavior,
			nowMs(),
		)
		store(closed)
	})
	pi.on('before_agent_start', event =>
		collector.onBeforeAgentStart(event.prompt, nowMs()),
	)
	pi.on('cache_warming_decision', event =>
		collector.onCacheWarmingDecision(event),
	)
	pi.on('agent_settled', () => store(collector.settle(nowMs())))
	pi.on('session_shutdown', () => store(collector.settle(nowMs())))
}

function wireRequestTimings(
	pi: ExtensionAPI,
	collector: TimingCollector,
): void {
	pi.on('before_provider_request', () =>
		collector.onProviderRequestOpen(nowMs()),
	)
	pi.on('after_provider_response', () =>
		collector.onProviderResponse(nowMs()),
	)
	pi.on('message_start', event => {
		if (event.message.role === 'assistant')
			collector.onAssistantMessageStart(event.message, nowMs())
	})
	pi.on('message_update', event => {
		if (
			event.message.role === 'assistant' &&
			event.assistantMessageEvent.type.endsWith('delta')
		)
			collector.onAssistantDelta(event.message, nowMs())
	})
	pi.on('message_end', event => {
		if (event.message.role === 'assistant')
			collector.onAssistantMessageEnd(event.message, nowMs())
	})
}

function wireToolTimings(pi: ExtensionAPI, collector: TimingCollector): void {
	pi.on('turn_end', event => collector.onTurnToolResults(event.toolResults))
	pi.on('tool_execution_start', event =>
		collector.onToolExecutionStart(
			event.toolCallId,
			event.toolName,
			nowMs(),
		),
	)
	pi.on('tool_execution_end', event =>
		collector.onToolExecutionEnd(event.toolCallId, nowMs()),
	)
}

function registerLatencyCommand(
	pi: ExtensionAPI,
	collector: TimingCollector,
): void {
	pi.registerCommand('latency', {
		description:
			'Measured per-prompt timings (provider wait/stream, tools, compaction, hooks)',
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				summarizeTimings(
					ctx.sessionManager.getBranch(),
					collector.snapshot(nowMs()),
				).join('\n'),
				'info',
			)
		},
	})
}

export function registerPromptTimings(pi: ExtensionAPI): void {
	const collector = new TimingCollector()
	wireTimingCollector(pi, collector)
	wireRequestTimings(pi, collector)
	wireToolTimings(pi, collector)
	wireCompactionTimings(pi, collector)
	registerLatencyCommand(pi, collector)
}
