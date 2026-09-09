import assert from 'node:assert/strict'
import test from 'node:test'

import {
	repliesFromPayload,
	wantsReplies,
} from '../extensions/twitter-fetch/conversation.ts'
import { autoFetchedContext } from '../extensions/twitter-fetch/status-context.ts'
import {
	conversationApiUrl,
	statusApiUrl,
} from '../extensions/twitter-fetch/status-url.ts'

const TWEET_PROMPT = 'what about https://x.com/a/status/1?'
const REPLIES_PROMPT = `show me the replies to https://x.com/a/status/1`

/** FxTwitter conversation body: a root status plus `replyCount` replies. */
function conversation(replyCount: number): string {
	const replies = []
	for (let index = 0; index < replyCount; index += 1) {
		replies.push({
			id: `10${index}`,
			text: `reply ${index}`,
			author: { screen_name: `user-${index}` },
			likes: index,
			created_at: `date ${index}`,
		})
	}
	return JSON.stringify({ status: { text: 'root' }, replies })
}

function fakeFetcher(bodies: Record<string, string>): typeof fetch {
	return async (input: string | URL | Request) => {
		const url = typeof input === 'string' ? input : input.toString()
		const body = bodies[url]
		if (body === undefined) {
			return new Response('not found', { status: 404 })
		}
		return new Response(body, {
			status: 200,
			headers: { 'content-type': 'application/json' },
		})
	}
}

function statusBody(): string {
	return JSON.stringify({
		status: { text: 'root', author: { screen_name: 'a' } },
	})
}

void test('detects replies intent in English and French prompts', () => {
	assert.ok(wantsReplies('montre-moi les réponses à ce tweet'))
	assert.ok(wantsReplies('show the replies to this tweet'))
	assert.ok(wantsReplies('answer the people who responded'))
	assert.ok(!wantsReplies('read this tweet and summarize it'))
})

void test('reply summaries carry author, text, date, like count and id', () => {
	const summaries = repliesFromPayload(JSON.parse(conversation(2)))
	assert.deepEqual(summaries, [
		{
			likes: 0,
			id: '100',
			author: 'user-0',
			text: 'reply 0',
			wasTextTruncated: false,
			createdAt: 'date 0',
		},
		{
			likes: 1,
			id: '101',
			author: 'user-1',
			text: 'reply 1',
			wasTextTruncated: false,
			createdAt: 'date 1',
		},
	])
})

void test('reply summaries expose their tree place and media stub', () => {
	const payload = {
		replies: [
			{ id: '500', text: 'parent', author: { screen_name: 'parent' } },
			{
				id: '501',
				text: 'child',
				author: { screen_name: 'child' },
				likes: 9,
				replying_to: { screen_name: 'parent', status: '500' },
				media: {
					photos: [
						{
							url: 'https://pbs.twimg.com/x.jpg',
							type: 'photo',
							altText: 'a screenshot',
						},
					],
				},
			},
		],
	}
	const summaries = repliesFromPayload(payload)

	assert.deepEqual(summaries[0], {
		id: '500',
		author: 'parent',
		text: 'parent',
		wasTextTruncated: false,
	})
	assert.deepEqual(summaries[1], {
		id: '501',
		likes: 9,
		replyingTo: 'parent',
		media: { photos: 1, altTexts: ['a screenshot'] },
		author: 'child',
		text: 'child',
		wasTextTruncated: false,
	})
})

void test('replies beyond the cap are dropped, textless replies skipped', () => {
	const payloads = conversation(21).replace(
		'"replies":[',
		'"replies":[{"media":{}},',
	)
	const summaries = repliesFromPayload(JSON.parse(payloads))

	assert.equal(summaries.length, 20)
	assert.equal(summaries[0]?.text, 'reply 0')
	assert.equal(summaries[19]?.text, 'reply 19')
})

void test('prompts asking for replies embed reply summaries in the tweet line', async () => {
	const context = await autoFetchedContext(
		REPLIES_PROMPT,
		fakeFetcher({
			[statusApiUrl('1')]: statusBody(),
			[conversationApiUrl('1')]: conversation(3),
		}),
	)

	interface ParsedLine {
		text: string
		replies?: Array<{ text: string; likes: number; id?: string }>
	}
	const parsed: ParsedLine = JSON.parse(
		(context ?? '').split('\n')[4] ?? '{}',
	)
	assert.equal(parsed.text, 'root')
	assert.deepEqual(
		parsed.replies?.map(reply => reply.text),
		['reply 0', 'reply 1', 'reply 2'],
	)
	assert.equal(parsed.replies?.[1]?.likes, 1)
})

void test('replies intent also embeds the quoted tweet conversation', async () => {
	const bodies = {
		[statusApiUrl('1')]: JSON.stringify({
			status: {
				text: 'root',
				author: { screen_name: 'a' },
				quote: {
					id: '222',
					text: 'quoted text',
					author: { screen_name: 'quoted-author' },
				},
			},
		}),
		[conversationApiUrl('1')]: conversation(2),
		[conversationApiUrl('222')]: conversation(1),
	}
	const context = await autoFetchedContext(
		REPLIES_PROMPT,
		fakeFetcher(bodies),
	)

	interface ParsedQuoteLine {
		replies?: Array<{ text: string }>
		quotes?: Array<{
			text: string
			replies?: Array<{ text: string }>
		}>
	}
	const parsedQuote: ParsedQuoteLine = JSON.parse(
		(context ?? '').split('\n')[4] ?? '{}',
	)
	assert.deepEqual(
		parsedQuote.quotes?.map(quote => quote.text),
		['quoted text'],
	)
	assert.deepEqual(
		parsedQuote.quotes?.[0]?.replies?.map(reply => reply.text),
		['reply 0'],
	)
	// the root conversation is still fetched for the root itself
	assert.deepEqual(
		parsedQuote.replies?.map(reply => reply.text),
		['reply 0', 'reply 1'],
	)
})

void test('replies intent skips tweets whose fetch failed too', async () => {
	const prompt = `the replies to this are gone: https://x.com/a/status/1`
	const context = await autoFetchedContext(prompt, fakeFetcher({}))

	assert.equal(context, undefined)
})

void test('prompts without replies intent never call the conversation endpoint', async () => {
	const bodies = { [statusApiUrl('1')]: statusBody() }
	const fetcher: typeof fetch = async input => {
		const url = typeof input === 'string' ? input : input.toString()
		if (url === conversationApiUrl('1')) {
			throw new Error(`unexpected conversation fetch: ${url}`)
		}
		const body = bodies[url]
		if (body === undefined)
			return new Response('not found', { status: 404 })
		return new Response(body, {
			status: 200,
			headers: { 'content-type': 'application/json' },
		})
	}

	const context = await autoFetchedContext(TWEET_PROMPT, fetcher)
	assert.ok(context?.includes('"text":"root"'))
	// no replies key anywhere, no conversation fetch attempted
	assert.ok(!context?.includes('replies'))
})

void test('a failed conversation fetch still embeds the tweet alone', async () => {
	const context = await autoFetchedContext(
		REPLIES_PROMPT,
		fakeFetcher({ [statusApiUrl('1')]: statusBody() }),
	)

	assert.ok(context?.startsWith('\n\n'))
	assert.ok(!context?.includes('"replies"'))
})
