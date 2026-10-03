// Reader for prompt timing records: plain-text summaries for the `/latency`
// command. This module only renders facts the records already contain; it
// does not measure anything itself.

import { formatActivityDuration } from '#lib/ui/activity-timing.ts'

import { promptTimingRecords } from './timing-entry.ts'

import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import type {
	PromptTimingRecord,
	TimingRequest,
	TimingUsage,
} from './timing-records.ts'

const OUTCOME_MARK: Record<PromptTimingRecord['outcome'], string> = {
	active: '•',
	completed: '✓',
	aborted: '✗',
	error: '×',
}

/** The readout keeps the newest prompts; this many older ones collapse into a line. */
const LATENCY_VISIBLE_RECORDS = 10

function usageText(usage: TimingUsage): string {
	return `tok in ${usage.input} out ${usage.output} cache r ${usage.cacheRead} w ${usage.cacheWrite}`
}

function requestText(request: TimingRequest): string {
	const wait = formatActivityDuration(request.waitMs)
	const total = formatActivityDuration(request.requestMs)
	const first = formatActivityDuration(request.firstOutputMs)
	const model = `${request.provider}/${request.model}`
	const tokens = request.usage ? ` · ${usageText(request.usage)}` : ''
	return `↳ ${model} wait ${wait} first ${first} total ${total} · ${request.thinkingLevel}${tokens}`
}

function toolBookText(record: PromptTimingRecord): string {
	const book = record.tools
	const spanMs = recordSpanMs(record)
	const span = spanMs ?? book.wallMs
	const calls = book.calls === 1 ? '1 call' : `${book.calls} calls`
	const rowsMark =
		book.toolRowsOmitted > 0
			? ` (+${book.toolRowsOmitted} tools capped)`
			: ''
	return `⇢ tools ${calls} · on the clock ${formatActivityDuration(book.wallMs)}${rowsMark} · record span ${formatActivityDuration(span)}`
}

/** Measured record span; `undefined` while a record closed without a settle. */
function recordSpanMs(record: PromptTimingRecord): number | undefined {
	const { endedAtMs } = record
	// Epoch-ms timestamps are never 0, so truthiness is the presence check here.
	if (!endedAtMs) return undefined
	return endedAtMs - record.startedAtMs
}

function recordText(record: PromptTimingRecord): string[] {
	const span = formatActivityDuration(recordSpanMs(record))
	const lines = [
		`● ${record.prompt} ${OUTCOME_MARK[record.outcome]} ${span}`,
		...aggregateText(record),
	]
	for (const request of record.requests) lines.push(requestText(request))
	if (record.requestsOmitted > 0)
		lines.push(
			`  … ${record.requestsOmitted} more requests beyond the record cap`,
		)
	if (record.unpairedRequests > 0)
		lines.push(
			`  ⇢ ${record.unpairedRequests} provider request(s) without a tracked response`,
		)
	if (record.warmRequests > 0)
		lines.push(
			`  ⇢ ${record.warmRequests} prompt-cache warm decision(s), no measured duration`,
		)
	lines.push(toolBookText(record))
	for (const compaction of record.compactions) {
		lines.push(
			`↺ compaction ${compaction.reason}/${compaction.outcome} ${formatActivityDuration(compaction.durationMs)}`,
		)
	}
	if (record.compactionsOmitted > 0)
		lines.push(
			`  … ${record.compactionsOmitted} more compactions beyond the record cap`,
		)
	for (const hook of record.hooks)
		lines.push(
			`ω hook ${hook.event} ${hook.name} ${formatActivityDuration(hook.durationMs)}`,
		)
	if (record.hooksDropped > 0)
		lines.push(
			`  … ${record.hooksDropped} more hooks beyond the record cap`,
		)
	return lines
}

function aggregateText(record: PromptTimingRecord): string[] {
	const requests = record.requestTotals
	const tokens = requests.usage ? ` · ${usageText(requests.usage)}` : ''
	return [
		`Σ responses ${requests.count} · measured ${requests.measured} · ${formatActivityDuration(requests.durationMs)}${tokens}`,
		`Σ checkpoints ${record.compactionTotals.count} · ${formatActivityDuration(record.compactionTotals.durationMs)}; hooks ${record.hookTotals.count} · ${formatActivityDuration(record.hookTotals.durationMs)}`,
	]
}

/** `/latency` body: persisted intervals plus the current in-memory snapshot. */
export function summarizeTimings(
	branch: readonly SessionEntry[],
	active?: PromptTimingRecord,
): string[] {
	const records = [
		...promptTimingRecords(branch),
		...(active ? [active] : []),
	]
	const lines: string[] = []
	if (!records.length) {
		lines.push('No timing records on this session branch yet.')
		return lines
	}
	for (const record of records.slice(-LATENCY_VISIBLE_RECORDS).toReversed())
		lines.push(...recordText(record), '')
	if (records.length > LATENCY_VISIBLE_RECORDS)
		lines.push(
			`... ${records.length - LATENCY_VISIBLE_RECORDS} older prompts beyond this latency view`,
		)
	return lines
}
