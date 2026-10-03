// Bounded measured-timing record for one prompt: the session entry type that
// carries it, its caps, and the verbatim usage ops. Every duration and count
// in a record is measured by hud-telemetry at pi's own event boundaries - see
// timing-collector.ts; the entry read-back lives in timing-entry.ts and the
// pure prompt-window bookkeeping in timing-book.ts.

import type {
	CheckpointReason,
	CheckpointFinished,
	CheckpointUsage,
} from '#lib/context-budget/events.ts'
import type { TimingTotals } from './timing-totals.ts'

/** The custom entry one measured activity interval is stored as. */
export const PROMPT_TIMING_ENTRY = 'pi-hud-telemetry-prompt-timing-v2'

/** Request detail rows kept per record; the rest collapse into `requestsOmitted`. */
export const MAX_TIMING_REQUESTS = 24
/** Per-name tool rows kept; `calls` and `wallMs` stay complete beyond the cap. */
export const MAX_TIMING_TOOL_ROWS = 24
/** Measured hook rows kept per record; the rest collapse into `hooksDropped`. */
export const MAX_TIMING_HOOKS = 32
/** Compaction rows kept per record; the rest collapse into `compactionsOmitted`. */
export const MAX_TIMING_COMPACTIONS = 8
/** Prompt excerpt width; the stored excerpt is the first line, nothing more. */
const MAX_PROMPT_EXCERPT_COLUMNS = 120

/** Token counts pi reported for one model response, verbatim `Usage` fields. */
export type TimingUsage = CheckpointUsage

/** The verbatim token fields of a pi `Usage`, cleared of every other field. */
export function timingUsageOf(usage: TimingUsage): TimingUsage {
	return {
		input: usage.input,
		output: usage.output,
		cacheRead: usage.cacheRead,
		cacheWrite: usage.cacheWrite,
	}
}

/** Add two stored token totals field by field (nested tool work adds up). */
export function addTimingUsage(
	base: TimingUsage | undefined,
	usage: TimingUsage,
): TimingUsage {
	if (!base) return usage
	return {
		input: base.input + usage.input,
		output: base.output + usage.output,
		cacheRead: base.cacheRead + usage.cacheRead,
		cacheWrite: base.cacheWrite + usage.cacheWrite,
	}
}

/** Measured timing of one provider request and the response it produced. */
export type TimingRequest = {
	/** When the request payload was sent (`before_provider_request`). */
	atMs: number
	/** Payload → response, measured at pi's provider boundary events. */
	waitMs?: number
	/** Response → first streamed content; measured, dropped when nothing streams. */
	firstOutputMs?: number
	/** Payload → assistant message finalized; measured at `message_end`. */
	requestMs?: number
	provider: string
	/** `responseModel` when the provider answered with a different model than requested. */
	model: string
	/** pi thinking level the agent loop requested for this response. */
	thinkingLevel: string
	usage?: TimingUsage
}

/** Measured totals for one tool name: exactly what its executions cost. */
export type TimingToolRow = {
	name: string
	calls: number
	/** Sum of per-call `tool_execution_start`→`end` intervals. */
	activeMs: number
	/** `Usage` the tool reported on its results, verbatim, added over the calls. */
	usage?: TimingUsage
}

/** The tool side of a prompt record: complete counts, capped per-name rows. */
export type TimingToolBook = {
	/** Measured wall time: overlapping and nested tool intervals count once. */
	wallMs: number
	/** Every execution started in the prompt; the time denominator stays `wallMs`. */
	calls: number
	/** Per-name rows capped at `MAX_TIMING_TOOL_ROWS`; the rest count here. */
	toolRowsOmitted: number
	rows: TimingToolRow[]
}

/** Measured checkpoint execution; manual runs include Pi's history write. */
export type TimingCompaction = {
	/** When the compaction started. */
	atMs: number
	/** Checkpoint start → completion or failure, measured at its owner. */
	durationMs: number
	/** Pi's compaction trigger, or direct automatic checkpoint execution. */
	reason: CheckpointReason
	outcome: CheckpointFinished['outcome']
	/** The aborted turn retried after this compaction (pi's overflow recovery). */
	willRetry: boolean
	/** `Usage` the summary generation reported, verbatim from the compaction entry. */
	usage?: TimingUsage
}

/** One measured hook cost reported through the shared hook timing channel. */
export type TimingHook = {
	/** When the measured hook run started. */
	atMs: number
	/** Measured duration of the hook run. */
	durationMs: number
	/** The pi event the hook was measured in. */
	event: string
	name: string
}

export type TimingOutcome = 'active' | 'completed' | 'aborted' | 'error'

/** One prompt's measured timing record; stored verbatim as `data` on the entry. */
export type PromptTimingRecord = {
	/** First line of the prompt text; each extension continuation keeps its own text. */
	prompt: string
	startedAtMs: number
	/** Measured at `agent_settled`; omitted while the record closed in flight. */
	endedAtMs?: number
	outcome: TimingOutcome
	requests: TimingRequest[]
	requestTotals: TimingTotals
	requestsOmitted: number
	/** Provider requests that produced no tracked response (failures, cache warming). */
	unpairedRequests: number
	/**
	 * Warm refreshes pi decided inside the window: `cache_warming_decision`
	 * events with action `warm`. Warm requests run outside the agent pipeline
	 * and produce no provider boundary events, so they carry no duration.
	 */
	warmRequests: number
	tools: TimingToolBook
	compactions: TimingCompaction[]
	compactionTotals: TimingTotals
	compactionsOmitted: number
	hooks: TimingHook[]
	hookTotals: TimingTotals
	hooksDropped: number
}

/** Strip a prompt text to its stored excerpt shape: one line, capped. */
export function promptExcerpt(promptText: string): string {
	const firstLine = promptText.split('\n', 1)[0]?.trim() ?? ''
	return firstLine.length > MAX_PROMPT_EXCERPT_COLUMNS
		? `${firstLine.slice(0, MAX_PROMPT_EXCERPT_COLUMNS)}…`
		: firstLine
}
