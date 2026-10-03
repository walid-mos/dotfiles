// Storage read-back for prompt timing records: field-by-field validation of
// the stored custom entries. The record types and caps live in
// timing-records.ts; this module is the session-storage boundary - entry data
// the writer produced unfolds here, anything that does not shape up is
// skipped, and no duration is recomputed while reading.

import {
	CHECKPOINT_REASONS,
	CHECKPOINT_OUTCOMES,
} from '#lib/context-budget/events.ts'

import { isRecord } from '../hud-footer/json.ts'

import {
	isMeasuredMs,
	isTokenCount,
	optionalMeasuredMs,
} from './timing-entry-values.ts'
import { PROMPT_TIMING_ENTRY } from './timing-records.ts'
import { readTimingTotals, readTimingUsage } from './timing-totals.ts'

import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import type {
	PromptTimingRecord,
	TimingCompaction,
	TimingHook,
	TimingRequest,
	TimingToolBook,
	TimingToolRow,
} from './timing-records.ts'

function readTimingRequest(row: unknown): TimingRequest | undefined {
	if (!isRecord(row)) return undefined
	const usage = readTimingUsage(row.usage)
	const waitMs = optionalMeasuredMs(row.waitMs)
	const firstOutputMs = optionalMeasuredMs(row.firstOutputMs)
	const requestMs = optionalMeasuredMs(row.requestMs)
	const { provider, model, thinkingLevel } = row
	if (
		!isMeasuredMs(row.atMs) ||
		typeof provider !== 'string' ||
		typeof model !== 'string'
	)
		return undefined
	return {
		atMs: row.atMs,
		// oxlint-disable-next-line nextnode/no-undefined-comparison - a measured interval may be exactly 0
		...(waitMs !== undefined && { waitMs }),
		// oxlint-disable-next-line nextnode/no-undefined-comparison - a measured interval may be exactly 0
		...(firstOutputMs !== undefined && { firstOutputMs }),
		// oxlint-disable-next-line nextnode/no-undefined-comparison - a measured interval may be exactly 0
		...(requestMs !== undefined && { requestMs }),
		provider,
		model,
		thinkingLevel:
			typeof thinkingLevel === 'string' ? thinkingLevel : 'off',
		...(usage && { usage }),
	}
}

function readTimingToolRow(row: unknown): TimingToolRow | undefined {
	if (!isRecord(row)) return undefined
	const { name, calls, activeMs } = row
	const usage = readTimingUsage(row.usage)
	if (
		typeof name !== 'string' ||
		!isTokenCount(calls) ||
		!isMeasuredMs(activeMs)
	)
		return undefined
	return {
		name,
		calls,
		activeMs,
		...(usage && { usage }),
	}
}

function readTimingCompaction(row: unknown): TimingCompaction | undefined {
	if (!isRecord(row)) return undefined
	const { reason, outcome, willRetry } = row
	const usage = readTimingUsage(row.usage)
	const trigger = CHECKPOINT_REASONS.find(option => option === reason)
	const settled = CHECKPOINT_OUTCOMES.find(option => option === outcome)
	if (
		!isMeasuredMs(row.atMs) ||
		!isMeasuredMs(row.durationMs) ||
		!trigger ||
		!settled
	)
		return undefined
	return {
		atMs: row.atMs,
		durationMs: row.durationMs,
		reason: trigger,
		outcome: settled,
		willRetry: willRetry === true,
		...(usage && { usage }),
	}
}

function readTimingHook(row: unknown): TimingHook | undefined {
	if (!isRecord(row)) return undefined
	const { event, name } = row
	if (
		!isMeasuredMs(row.atMs) ||
		!isMeasuredMs(row.durationMs) ||
		typeof event !== 'string' ||
		typeof name !== 'string'
	)
		return undefined
	return { atMs: row.atMs, durationMs: row.durationMs, event, name }
}

function readToolBook(candidate: unknown): TimingToolBook {
	if (!isRecord(candidate))
		return { wallMs: 0, calls: 0, toolRowsOmitted: 0, rows: [] }
	const rows = parseRows(candidate.rows, readTimingToolRow)
	const toolRowsOmitted = isTokenCount(candidate.toolRowsOmitted)
		? candidate.toolRowsOmitted
		: 0
	return {
		wallMs: isMeasuredMs(candidate.wallMs) ? candidate.wallMs : 0,
		calls: isTokenCount(candidate.calls) ? candidate.calls : 0,
		toolRowsOmitted,
		rows,
	}
}

/** Parse arrays of stored rows, dropping anything that fails its guard. */
function parseRows<T>(
	candidate: unknown,
	read: (row: unknown) => T | undefined,
): T[] {
	if (!Array.isArray(candidate)) return []
	return candidate.flatMap(row => {
		const parsed = read(row)
		return parsed ? [parsed] : []
	})
}

/** A stored count field, 0 when absent or malformed. */
function readCountField(candidate: unknown): number {
	return isTokenCount(candidate) ? candidate : 0
}

/** Validate one stored record; `undefined` when the entry data does not shape up. */
export function readPromptTimingRecord(
	candidate: unknown,
): PromptTimingRecord | undefined {
	if (!isRecord(candidate)) return undefined
	const { prompt, startedAtMs, outcome } = candidate
	if (typeof prompt !== 'string' || !isMeasuredMs(startedAtMs))
		return undefined
	const requestTotals = readTimingTotals(candidate.requestTotals)
	const compactionTotals = readTimingTotals(candidate.compactionTotals)
	const hookTotals = readTimingTotals(candidate.hookTotals)
	if (!requestTotals || !compactionTotals || !hookTotals) return undefined
	const endedAtMs = optionalMeasuredMs(candidate.endedAtMs)
	const isOutcome = TIMING_OUTCOMES.find(mark => mark === outcome)
	return {
		prompt,
		startedAtMs,
		// oxlint-disable-next-line nextnode/no-undefined-comparison - timestamps, not durations
		...(endedAtMs !== undefined && { endedAtMs }),
		outcome: isOutcome ?? 'completed',
		requestTotals,
		compactionTotals,
		hookTotals,
		requests: parseRows(candidate.requests, readTimingRequest),
		requestsOmitted: readCountField(candidate.requestsOmitted),
		unpairedRequests: readCountField(candidate.unpairedRequests),
		warmRequests: readCountField(candidate.warmRequests),
		tools: readToolBook(candidate.tools),
		compactions: parseRows(candidate.compactions, readTimingCompaction),
		compactionsOmitted: readCountField(candidate.compactionsOmitted),
		hooks: parseRows(candidate.hooks, readTimingHook),
		hooksDropped: readCountField(candidate.hooksDropped),
	}
}

const TIMING_OUTCOMES = ['active', 'completed', 'aborted', 'error'] as const

/** Every timing record on the branch, oldest first; unusable entries are skipped. */
export function promptTimingRecords(
	branch: readonly SessionEntry[],
): PromptTimingRecord[] {
	const records: PromptTimingRecord[] = []
	for (const entry of branch) {
		if (entry.type !== 'custom') continue
		if (!isRecord(entry) || entry.customType !== PROMPT_TIMING_ENTRY)
			continue
		const parsed = readPromptTimingRecord(entry.data)
		if (parsed) records.push(parsed)
	}
	return records
}
