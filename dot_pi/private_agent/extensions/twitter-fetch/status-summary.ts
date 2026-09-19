/** FxTwitter status payloads: compact JSON-able summaries for the context. */

import {
	fxtwitterArray,
	fxtwitterNumber,
	fxtwitterRecord,
	fxtwitterString,
} from './fx-payload.ts'
import { quoteChainStatuses } from './quote-chain.ts'
import { statusMediaStub } from './status-media.ts'

import type { FxTwitterRecord } from './fx-payload.ts'
import type { MediaStub } from './status-media.ts'

const MAX_QUOTE_TEXT_CHARACTERS = 4_000
const MAX_THREAD_STATUSES = 10
const MAX_THREAD_TEXT_CHARACTERS = 4_000

const ENGAGEMENT_FIELDS = ['likes', 'reposts', 'replies', 'views'] as const

type PollChoiceSummary = {
	readonly label?: string
	readonly count?: number
}

export type PollSummary = {
	readonly totalVotes?: number
	readonly choices?: readonly PollChoiceSummary[]
}

/** One status's compact text summary, shared by root, quotes, thread and replies. */
export type StatusTextSummary = {
	readonly author?: string
	readonly text: string
	readonly wasTextTruncated: boolean
	readonly createdAt?: string
}

/** A status inside a quote chain or a thread: text plus its media stub. */
export type StatusChainSummary = StatusTextSummary & {
	readonly id?: string
	readonly media?: MediaStub
}

/** The root tweet's full context summary embedded as one JSON line. */
export type StatusContext = StatusTextSummary & {
	readonly statusId: string
	readonly engagement?: Record<string, number>
	readonly poll?: PollSummary
	readonly media?: MediaStub
	readonly communityNote?: string
	readonly replyingTo?: string
	readonly quotes?: readonly StatusChainSummary[]
	readonly thread?: readonly StatusChainSummary[]
}

function statusTextSummary(
	status: FxTwitterRecord,
	maxTextCharacters: number,
): StatusTextSummary | undefined {
	const fullText = fxtwitterString(status, 'text')
	if (!fullText) return undefined
	const author = fxtwitterString(
		fxtwitterRecord(status.author),
		'screen_name',
	)
	const createdAt = fxtwitterString(status, 'created_at')
	return {
		text: fullText.slice(0, maxTextCharacters),
		wasTextTruncated: fullText.length > maxTextCharacters,
		...(author && { author }),
		...(createdAt && { createdAt }),
	}
}

/** One status's compact text summary; undefined when the status has no text. */
export function summarizeStatus(
	status: unknown,
	maxTextCharacters: number,
): StatusTextSummary | undefined {
	const statusRecord = fxtwitterRecord(status)
	if (!statusRecord) return undefined
	return statusTextSummary(statusRecord, maxTextCharacters)
}

/** Engagement numbers present on the status, omitted entirely when none. */
export function statusEngagement(
	status: FxTwitterRecord,
): Record<string, number> | undefined {
	const entries: Array<[string, number]> = []
	for (const field of ENGAGEMENT_FIELDS) {
		const fieldValue = fxtwitterNumber(status, field)
		if (typeof fieldValue === 'number') entries.push([field, fieldValue])
	}
	if (!entries.length) return undefined
	return Object.fromEntries(entries)
}

/** Compact poll summary; undefined when the status has no poll. */
export function statusPollSummary(
	status: FxTwitterRecord,
): PollSummary | undefined {
	const poll = fxtwitterRecord(status.poll)
	if (!poll) return undefined
	const totalVotes = fxtwitterNumber(poll, 'total_votes')
	const summarizedChoices: PollChoiceSummary[] = []
	for (const choice of fxtwitterArray(poll, 'choices') ?? []) {
		const choiceRecord = fxtwitterRecord(choice)
		const label = fxtwitterString(choiceRecord, 'label')
		const count = fxtwitterNumber(choiceRecord, 'count')
		// A 0 vote count is real data: never drop it through a truthy check.
		if (!label && typeof count !== 'number') continue
		summarizedChoices.push({
			...(label && { label }),
			...(typeof count === 'number' && { count }),
		})
	}
	if (!summarizedChoices.length && typeof totalVotes !== 'number') {
		return undefined
	}
	return {
		...(typeof totalVotes === 'number' && { totalVotes }),
		...(summarizedChoices.length && { choices: summarizedChoices }),
	}
}

/** The community note's text, when one is attached. */
export function statusCommunityNote(
	status: FxTwitterRecord,
): string | undefined {
	return fxtwitterString(fxtwitterRecord(status.community_note), 'text')
}

/** Handle of the status this one replies to, when known. */
export function statusReplyingTo(status: FxTwitterRecord): string | undefined {
	return fxtwitterString(fxtwitterRecord(status.replying_to), 'screen_name')
}

/** Text summary with media stub and id, for one quoted/threaded status. */
function statusChainSummary(
	status: FxTwitterRecord,
	maxTextCharacters: number,
): StatusChainSummary | undefined {
	const summary = statusTextSummary(status, maxTextCharacters)
	if (!summary) return undefined
	const id = fxtwitterString(status, 'id')
	const media = statusMediaStub(status)
	return {
		...summary,
		...(id && { id }),
		...(media && { media }),
	}
}

/** Text summaries of the root status's quote chain, root excluded. */
function summarizeQuotedStatuses(
	rootStatus: FxTwitterRecord,
	maxTextCharacters: number,
): StatusChainSummary[] {
	const summaries: StatusChainSummary[] = []
	for (const entry of quoteChainStatuses(rootStatus)) {
		if (entry.depth === 0) continue
		const summary = statusChainSummary(entry.status, maxTextCharacters)
		if (summary) summaries.push(summary)
	}
	return summaries
}

/** Text summaries of the thread statuses, root excluded, capped. */
function summarizeThreadStatuses(
	payload: FxTwitterRecord,
	rootStatus: FxTwitterRecord,
	maxTextCharacters: number,
): StatusChainSummary[] {
	const rootStatusId = fxtwitterString(rootStatus, 'id')
	const summaries: StatusChainSummary[] = []
	for (const threadStatus of fxtwitterArray(payload, 'thread') ?? []) {
		if (summaries.length >= MAX_THREAD_STATUSES) break
		const status = fxtwitterRecord(threadStatus)
		if (!status) continue
		if (rootStatusId && fxtwitterString(status, 'id') === rootStatusId) {
			continue
		}
		const summary = statusChainSummary(status, maxTextCharacters)
		if (summary) summaries.push(summary)
	}
	return summaries
}

/** The root tweet's full context summary; undefined when it has no text. */
export function summarizeStatusContext(
	payload: unknown,
	statusId: string,
	maxRootTextCharacters: number,
): StatusContext | undefined {
	const payloadRecord = fxtwitterRecord(payload)
	if (!payloadRecord) return undefined
	const rootStatus = fxtwitterRecord(payloadRecord.status)
	if (!rootStatus) return undefined
	const baseSummary = statusTextSummary(rootStatus, maxRootTextCharacters)
	if (!baseSummary) return undefined
	const engagement = statusEngagement(rootStatus)
	const poll = statusPollSummary(rootStatus)
	const media = statusMediaStub(rootStatus)
	const communityNote = statusCommunityNote(rootStatus)
	const replyingTo = statusReplyingTo(rootStatus)
	const quotes = summarizeQuotedStatuses(
		rootStatus,
		MAX_QUOTE_TEXT_CHARACTERS,
	)
	const thread = summarizeThreadStatuses(
		payloadRecord,
		rootStatus,
		MAX_THREAD_TEXT_CHARACTERS,
	)
	return {
		statusId,
		...baseSummary,
		...(engagement && { engagement }),
		...(poll && { poll }),
		...(media && { media }),
		...(communityNote && { communityNote }),
		...(replyingTo && { replyingTo }),
		...(quotes.length && { quotes }),
		...(thread.length && { thread }),
	}
}
