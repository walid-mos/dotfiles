import assert from 'node:assert/strict'
import test from 'node:test'

import {
	AUTOFETCH_CONTEXT_MARKER,
	autoFetchedContext,
} from '../extensions/twitter-fetch/status-context.ts'
import { statusApiUrl } from '../extensions/twitter-fetch/status-url.ts'

/** FxTwitter API body for one status. */
function tweet(statusId: string, text: string): string {
	return JSON.stringify({
		status: {
			text,
			author: { screen_name: 'ada' },
			created_at: 'Sun Feb 01 12:00:00 +0000 2026',
		},
	})
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

const PROMPT = 'read https://x.com/ada/status/111 and this too, thanks!'

void test('prompt mentioning a status embeds its fetched context', async () => {
	const context = await autoFetchedContext(
		PROMPT,
		fakeFetcher({ [statusApiUrl('111')]: tweet('111', 'hello world') }),
	)

	assert.ok(context?.startsWith(`\n\n${AUTOFETCH_CONTEXT_MARKER}\n`))
	const lines = context?.split('\n') ?? []
	// [blank, blank, marker, warning, one JSON line per fetched status]
	assert.equal(lines.length, 5)
	assert.match(lines[3] ?? '', /untrusted external data/)
	interface ParsedTweet {
		statusId: string
		text: string
		author: string
		createdAt: string
		wasTextTruncated: boolean
	}
	const tweetLine: ParsedTweet = JSON.parse(lines[4] ?? '{}')
	assert.equal(tweetLine.statusId, '111')
	assert.equal(tweetLine.text, 'hello world')
	assert.equal(tweetLine.author, 'ada')
	assert.equal(tweetLine.createdAt, 'Sun Feb 01 12:00:00 +0000 2026')
	assert.equal(tweetLine.wasTextTruncated, false)
})

void test('failed fetches are skipped, never blocking the turn', async () => {
	const context = await autoFetchedContext(
		PROMPT,
		fakeFetcher({ [statusApiUrl('111')]: '' }),
	)

	assert.equal(context, undefined)
})

void test('prompts without status URLs fetch nothing', async () => {
	const context = await autoFetchedContext(
		'plain question about code',
		fakeFetcher({ [statusApiUrl('111')]: tweet('111', 'hi') }),
	)

	assert.equal(context, undefined)
})

void test('overlong tweet text is truncated and flagged', async () => {
	const longText = 'x'.repeat(12_001)
	const context = await autoFetchedContext(
		PROMPT,
		fakeFetcher({ [statusApiUrl('111')]: tweet('111', longText) }),
	)

	interface ParsedTweet {
		text: string
		wasTextTruncated: boolean
	}
	const tweetLine: ParsedTweet = JSON.parse(
		(context ?? '').split('\n')[4] ?? '{}',
	)
	assert.equal(tweetLine.text.length, 12_000)
	assert.equal(tweetLine.wasTextTruncated, true)
})

void test('multiple status URLs embed one JSON line each', async () => {
	const prompt =
		'compare https://x.com/a/status/1 vs https://x.com/b/status/2'
	const context = await autoFetchedContext(
		prompt,
		fakeFetcher({
			[statusApiUrl('1')]: tweet('1', 'first'),
			[statusApiUrl('2')]: tweet('2', 'second'),
		}),
	)

	const lines = (context ?? '')
		.split('\n')
		.filter(line => line.startsWith('{'))
	assert.equal(lines.length, 2)
})

function richTweet(): string {
	return JSON.stringify({
		status: {
			id: '999',
			text: 'root text',
			author: { screen_name: 'ada' },
			created_at: 'Sun Feb 01 12:00:00 +0000 2026',
			likes: 5,
			reposts: 2,
			replies: 34,
			views: 100,
			community_note: { text: 'note text' },
			replying_to: { screen_name: 'keith' },
			poll: {
				total_votes: 9,
				choices: [
					{ label: 'Yes', count: 6, percentage: 66 },
					{ label: 'No', count: 3, percentage: 33 },
				],
				ends_at: '2026-02-02T00:00:00Z',
				time_left_en: '1 day left',
			},
			quote: {
				id: '888',
				text: 'quoted text',
				author: { screen_name: 'bob' },
				media: {
					photos: [
						{
							url: 'https://pbs.twimg.com/q1.jpg',
							type: 'photo',
							altText: 'opencode version',
						},
					],
				},
				quote: { text: 'deep text', author: { screen_name: 'ann' } },
			},
			media: {
				photos: [
					{
						url: 'https://pbs.twimg.com/p1.jpg',
						type: 'photo',
						altText: 'a deploy log',
					},
				],
			},
		},
		thread: [
			{
				id: '999',
				text: 'the root again',
				author: { screen_name: 'ada' },
			},
			{ text: 'thread part 2', author: { screen_name: 'ada' } },
		],
	})
}

void test('context embeds quotes, thread, poll, engagement, note, reply target', async () => {
	const context = await autoFetchedContext(
		PROMPT,
		fakeFetcher({ [statusApiUrl('111')]: richTweet() }),
	)

	interface ParsedContext {
		statusId: string
		engagement: Record<string, number>
		poll: {
			totalVotes: number
			choices: Array<{ label?: string; count?: number }>
		}
		communityNote?: string
		replyingTo?: string
		media?: { photos?: number; gifs?: number; altTexts?: string[] }
		quotes?: Array<{ id?: string; text: string; media?: unknown }>
		thread?: Array<{ text: string }>
	}
	const parsed: ParsedContext = JSON.parse(
		(context ?? '').split('\n')[4] ?? '{}',
	)

	assert.deepEqual(parsed.engagement, {
		likes: 5,
		reposts: 2,
		replies: 34,
		views: 100,
	})
	// total_votes and label/count only; percentage and time are dropped
	assert.deepEqual(parsed.poll, {
		totalVotes: 9,
		choices: [
			{ label: 'Yes', count: 6 },
			{ label: 'No', count: 3 },
		],
	})
	assert.equal(parsed.communityNote, 'note text')
	assert.equal(parsed.replyingTo, 'keith')
	// media existence is visible without fetching anything else
	assert.deepEqual(parsed.media, { photos: 1, altTexts: ['a deploy log'] })
	assert.deepEqual(
		parsed.quotes?.map(quote => quote.text),
		['quoted text', 'deep text'],
	)
	// quoted tweets carry their id and own media stub
	assert.deepEqual(
		parsed.quotes?.filter(quote => quote.id).map(quote => quote.id),
		['888'],
	)
	assert.deepEqual(parsed.quotes?.[0]?.media, {
		photos: 1,
		altTexts: ['opencode version'],
	})
	// the root itself never appears as its own thread entry
	assert.deepEqual(
		parsed.thread?.map(threadStatus => threadStatus.text),
		['thread part 2'],
	)
})

void test('long quote texts are truncated and flagged', async () => {
	const quotedLong = 'y'.repeat(4_001)
	const payload = JSON.stringify({
		status: {
			text: 'root',
			author: { screen_name: 'ada' },
			quote: { text: quotedLong, author: { screen_name: 'bob' } },
		},
	})
	const context = await autoFetchedContext(
		PROMPT,
		fakeFetcher({ [statusApiUrl('111')]: payload }),
	)

	interface ParsedContext {
		quotes?: Array<{ text: string; wasTextTruncated: boolean }>
	}
	const parsed: ParsedContext = JSON.parse(
		(context ?? '').split('\n')[4] ?? '{}',
	)
	assert.equal(parsed.quotes?.length, 1)
	assert.equal(parsed.quotes?.[0]?.text.length, 4_000)
	assert.equal(parsed.quotes?.[0]?.wasTextTruncated, true)
})
