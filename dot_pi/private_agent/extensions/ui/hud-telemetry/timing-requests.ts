// Own provider-window pairing, streamed-message tracking and bounded request rows.
import {
	MAX_TIMING_REQUESTS,
	addTimingUsage,
	timingUsageOf,
} from './timing-records.ts'
import { emptyTimingTotals } from './timing-totals.ts'

import type { AssistantMessage } from '@earendil-works/pi-ai'
import type {
	PromptTimingRecord,
	TimingOutcome,
	TimingRequest,
} from './timing-records.ts'

type RequestWindow = {
	openedAtMs: number
	respondedAtMs?: number | undefined
}

type PendingAssistant = {
	window?: RequestWindow | undefined
	firstOutputAtMs?: number | undefined
}

type RequestRowInput = {
	window: RequestWindow
	firstOutputAtMs?: number | undefined
	message: AssistantMessage
	endedAtMs: number
}

export type RequestTimingSnapshot = Pick<
	PromptTimingRecord,
	| 'requests'
	| 'requestTotals'
	| 'requestsOmitted'
	| 'unpairedRequests'
	| 'warmRequests'
	| 'outcome'
>

/** The latest responded window wins; otherwise use the latest open window. */
function pairRequestWindow(
	windows: readonly RequestWindow[],
	nowMs: number,
): RequestWindow | undefined {
	const eligible = windows.filter(window => window.openedAtMs <= nowMs)
	const responded = eligible.filter(window => window.respondedAtMs)
	const ranked = responded.length > 0 ? responded : eligible
	return ranked.reduce<RequestWindow | undefined>((latest, window) => {
		if (!latest) return window
		return windowOrderKey(window) > windowOrderKey(latest) ? window : latest
	}, undefined)
}

function windowOrderKey(window: RequestWindow): number {
	return window.respondedAtMs ? window.respondedAtMs : window.openedAtMs
}

/** Calculate only observed intervals and copy provider identity and usage. */
function buildRequestTiming(row: RequestRowInput): TimingRequest {
	const { window, message } = row
	const timing: TimingRequest = {
		atMs: window.openedAtMs,
		requestMs: Math.max(0, row.endedAtMs - window.openedAtMs),
		provider: message.provider,
		model: message.responseModel ?? message.model,
		thinkingLevel: message.thinkingLevel ?? 'off',
		usage: timingUsageOf(message.usage),
	}
	if (window.respondedAtMs)
		timing.waitMs = Math.max(0, window.respondedAtMs - window.openedAtMs)
	if (row.firstOutputAtMs && window.respondedAtMs)
		timing.firstOutputMs = Math.max(
			0,
			row.firstOutputAtMs - window.respondedAtMs,
		)
	return timing
}

/** Append a calculated row, preserving the detail cap and omitted count. */
function bookRequestRow(
	requests: readonly TimingRequest[],
	requestsOmitted: number,
	timing: TimingRequest,
): { requests: TimingRequest[]; requestsOmitted: number } {
	if (requests.length >= MAX_TIMING_REQUESTS)
		return { requests: [...requests], requestsOmitted: requestsOmitted + 1 }
	return { requests: [...requests, timing], requestsOmitted }
}

function outcomeFromStopReason(
	stopReason: AssistantMessage['stopReason'],
): TimingOutcome {
	if (stopReason === 'aborted') return 'aborted'
	if (stopReason === 'error') return 'error'
	return 'completed'
}

export class TimingRequests {
	private windows: RequestWindow[] = []
	// Stream events may carry different snapshots of the same assistant message.
	private pendingAssistants = new Map<number, PendingAssistant>()
	private requests: TimingRequest[] = []
	private totals = emptyTimingTotals()
	private requestsOmitted = 0
	private unpairedRequests = 0
	private warmRequests = 0
	private lastStopReason: AssistantMessage['stopReason'] = 'stop'

	open(nowMs: number): void {
		if (this.windows.length >= MAX_TIMING_REQUESTS) {
			this.windows.shift()
			this.unpairedRequests += 1
		}
		this.windows.push({ openedAtMs: nowMs })
	}

	respond(nowMs: number): void {
		for (let index = this.windows.length - 1; index >= 0; index -= 1) {
			const window = this.windows[index]
			if (!window) return
			if (!window.respondedAtMs) {
				window.respondedAtMs = nowMs
				return
			}
		}
	}

	startMessage(message: AssistantMessage, nowMs: number): void {
		if (this.pendingAssistants.size >= MAX_TIMING_REQUESTS) {
			const oldest = this.pendingAssistants.keys().next()
			if (!oldest.done) this.pendingAssistants.delete(oldest.value)
		}
		this.pendingAssistants.set(message.timestamp, {
			window: pairRequestWindow(this.windows, nowMs),
		})
	}

	recordDelta(message: AssistantMessage, nowMs: number): void {
		const pending = this.pendingAssistants.get(message.timestamp)
		if (pending && !pending.firstOutputAtMs) pending.firstOutputAtMs = nowMs
	}

	endMessage(message: AssistantMessage, nowMs: number): void {
		const pending = this.pendingAssistants.get(message.timestamp)
		this.pendingAssistants.delete(message.timestamp)
		this.lastStopReason = message.stopReason
		this.totals = {
			...this.totals,
			count: this.totals.count + 1,
			usage: addTimingUsage(
				this.totals.usage,
				timingUsageOf(message.usage),
			),
		}
		const window = pending?.window ?? pairRequestWindow(this.windows, nowMs)
		if (!window) {
			this.unpairedRequests += 1
			return
		}
		const index = this.windows.indexOf(window)
		if (index !== -1) this.windows.splice(index, 1)
		const timing = buildRequestTiming({
			window,
			firstOutputAtMs: pending?.firstOutputAtMs,
			message,
			endedAtMs: nowMs,
		})
		this.totals = {
			...this.totals,
			measured: this.totals.measured + 1,
			durationMs: this.totals.durationMs + (timing.requestMs ?? 0),
		}
		const booked = bookRequestRow(
			this.requests,
			this.requestsOmitted,
			timing,
		)
		this.requests = booked.requests
		this.requestsOmitted = booked.requestsOmitted
	}

	recordWarmDecision(decision: { action?: 'warm' | 'stop' }): void {
		if (decision.action === 'warm') this.warmRequests += 1
	}

	snapshot(): RequestTimingSnapshot {
		return {
			requests: [...this.requests],
			requestTotals: this.totals,
			requestsOmitted: this.requestsOmitted,
			unpairedRequests: this.unpairedRequests + this.windows.length,
			warmRequests: this.warmRequests,
			outcome: outcomeFromStopReason(this.lastStopReason),
		}
	}
}
