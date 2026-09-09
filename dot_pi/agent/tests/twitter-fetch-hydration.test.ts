import assert from 'node:assert/strict'
import test from 'node:test'

import { hydrateTweetMedia } from '../extensions/twitter-fetch/media-hydration.ts'

import type {
	TweetImageResult,
	ToolContent,
} from '../extensions/twitter-fetch/media-hydration.ts'

function fetchedPayload(urls: string[]): string {
	return `# FxTwitter\n\n${JSON.stringify({
		status: {
			text: 'hello',
			media: {
				photos: urls.map((url, index) => ({
					url,
					type: 'photo',
					altText: index === 0 ? 'first' : undefined,
				})),
			},
		},
	})}\n\n---\n`
}

/** Fallback fetcher for the no-payload test: never awaited. */
async function unusedFetcher(): Promise<TweetImageResult> {
	throw new Error('not used')
}

function fetcherReturning(
	outcomes: Record<string, TweetImageResult>,
): (url: string, signal: AbortSignal | undefined) => Promise<TweetImageResult> {
	return async url => {
		const outcome = outcomes[url]
		if (outcome === undefined) throw new Error(`unexpected fetch ${url}`)
		return outcome
	}
}

const OK = (width: number, height: number): TweetImageResult => ({
	isSuccess: true,
	data: `bytes-${width}x${height}`,
	width,
	height,
	mimeType: 'image/png',
})

void test('prepends fetched images and appends a media note', async () => {
	const content: ToolContent[] = [
		{
			type: 'text',
			text: fetchedPayload(['https://pbs.twimg.com/p1.jpg']),
		},
	]
	const hydrated = await hydrateTweetMedia(
		content,
		undefined,
		undefined,
		fetcherReturning({
			'https://pbs.twimg.com/p1.jpg': OK(640, 480),
		}),
	)

	assert.ok(hydrated)
	assert.deepEqual(hydrated.content, [
		{ type: 'image', data: 'bytes-640x480', mimeType: 'image/png' },
		...content,
		{ type: 'text', text: 'Tweet media: photo 1 (first): 640×480' },
	])
	assert.deepEqual(hydrated.details, {
		hasImage: true,
		imageCount: 1,
		twitterMedia: ['photo 1 (first): 640×480'],
	})
})

void test('failed media downloads become notes, not errors', async () => {
	const content: ToolContent[] = [
		{
			type: 'text',
			text: fetchedPayload([
				'https://pbs.twimg.com/p1.jpg',
				'https://pbs.twimg.com/p2.jpg',
			]),
		},
	]
	const hydrated = await hydrateTweetMedia(
		content,
		undefined,
		undefined,
		fetcherReturning({
			'https://pbs.twimg.com/p1.jpg': OK(100, 50),
			'https://pbs.twimg.com/p2.jpg': {
				isSuccess: false,
				error: 'HTTP 404',
			},
		}),
	)

	assert.ok(hydrated)
	assert.deepEqual(hydrateContentToMedia(hydrated.content), ['bytes-100x50'])
	assert.deepEqual(hydrated.details.twitterMedia, [
		'photo 1 (first): 100×50',
		'photo 2: failed (HTTP 404)',
	])
	assert.equal(hydrated.details.imageCount, 1)
})

function hydrateContentToMedia(content: ToolContent[]): string[] {
	return content
		.filter(block => block.type === 'image')
		.map(block => block.data)
}

void test('nothing is hydrated when the result has no FxTwitter payload', async () => {
	const content: ToolContent[] = [{ type: 'text', text: 'plain docs' }]

	assert.equal(
		await hydrateTweetMedia(content, undefined, undefined, unusedFetcher),
		undefined,
	)
})

void test('existing imageCount is carried over, not reset', async () => {
	const content: ToolContent[] = [
		{
			type: 'text',
			text: fetchedPayload(['https://pbs.twimg.com/p1.jpg']),
		},
	]
	const hydrated = await hydrateTweetMedia(
		content,
		{ imageCount: 2, url: 'x' },
		undefined,
		fetcherReturning({ 'https://pbs.twimg.com/p1.jpg': OK(10, 10) }),
	)

	assert.equal(hydrated?.details.imageCount, 3)
	assert.equal(hydrated?.details.hasImage, true)
})

void test('quote texts are appended as a quotes note', async () => {
	const document = [
		'# FxTwitter',
		'',
		JSON.stringify({
			status: {
				text: 'root',
				media: {
					photos: [
						{ url: 'https://pbs.twimg.com/p1.jpg', type: 'photo' },
					],
				},
				quote: {
					text: 'quoted hello',
					author: { screen_name: 'bob' },
					quote: { text: 'nested quote text' },
				},
			},
		}),
		'',
		'---',
		'',
	].join('\n')
	const content: ToolContent[] = [{ type: 'text', text: document }]
	const hydrated = await hydrateTweetMedia(
		content,
		undefined,
		undefined,
		fetcherReturning({ 'https://pbs.twimg.com/p1.jpg': OK(10, 10) }),
	)

	assert.deepEqual(hydrated?.details.twitterQuotes, [
		'quoted @bob: quoted hello',
		'quoted 2 nested quote text',
	])
	assert.deepEqual(
		hydrated?.content
			.filter(block => block.type === 'text')
			.map(block => block.text),
		[
			document,
			'Tweet media: photo 1: 10×10',
			'Tweet quotes: quoted @bob: quoted hello; quoted 2 nested quote text',
		],
	)
})
