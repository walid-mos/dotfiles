/** Conversation replies: intent detection + reply summaries from FxTwitter. */

import {
	fxtwitterArray,
	fxtwitterNumber,
	fxtwitterRecord,
	fxtwitterString,
} from './fx-payload.ts'
import { statusMediaStub } from './status-media.ts'
import { statusReplyingTo } from './status-summary.ts'
import { summarizeStatus } from './status-summary.ts'

import type { StatusChainSummary } from './status-summary.ts'

const MAX_REPLIES = 20
const MAX_REPLY_TEXT_CHARACTERS = 4_000

/** English or French words that mean "give me the replies to this tweet". */
const REPLIES_INTENT_PATTERN =
	/\b(?:repl(?:ies|y)|answers?|responses?|réponses?|reponses?|répond(?:s|re|ez|es)?|repond(?:s|re|ez|es)?)\b/i

/** One reply summary: author/text/date plus its tree and media position. */
export type ReplySummary = StatusChainSummary & {
	readonly likes?: number
	readonly replyingTo?: string
}

export function wantsReplies(prompt: string): boolean {
	return REPLIES_INTENT_PATTERN.test(prompt)
}

/** Reply summaries of a conversation payload, capped. */
export function repliesFromPayload(payload: unknown): ReplySummary[] {
	const rawReplies = fxtwitterArray(fxtwitterRecord(payload), 'replies') ?? []
	const summaries: ReplySummary[] = []
	for (const rawReply of rawReplies) {
		if (summaries.length >= MAX_REPLIES) break
		const replyRecord = fxtwitterRecord(rawReply)
		if (!replyRecord) continue
		const summary = summarizeStatus(replyRecord, MAX_REPLY_TEXT_CHARACTERS)
		if (!summary) continue
		const likes = fxtwitterNumber(replyRecord, 'likes')
		const id = fxtwitterString(replyRecord, 'id')
		const replyingTo = statusReplyingTo(replyRecord)
		const media = statusMediaStub(replyRecord)
		summaries.push({
			...(typeof likes === 'number' && { likes }),
			...(id && { id }),
			...(replyingTo && { replyingTo }),
			...(media && { media }),
			...summary,
		})
	}
	return summaries
}
