import assert from 'node:assert/strict'
import test from 'node:test'

import { parseFxtwitterPayload } from '../extensions/twitter-fetch/fx-payload.ts'
import { collectTweetMedia } from '../extensions/twitter-fetch/tweet-media.ts'

const STATUS_MEDIA = {
	status: {
		text: 'hello',
		author: { screen_name: 'ada' },
		media: {
			photos: [
				{
					url: 'https://pbs.twimg.com/p1.jpg',
					type: 'photo',
					altText: 'a chart',
				},
				{ url: 'https://pbs.twimg.com/p2.gif', type: 'gif' },
			],
			videos: [{ thumbnail_url: 'https://pbs.twimg.com/v1.jpg' }],
		},
		quote: {
			text: 'quoted',
			media: {
				external: { thumbnail_url: 'https://pbs.twimg.com/ext.jpg' },
				mosaic: {
					url: 'https://pbs.twimg.com/fallback.jpg',
					formats: {},
				},
			},
			quote: {
				text: 'nested quote',
				card: { image: { url: 'https://pbs.twimg.com/card.jpg' } },
				quote: {
					text: 'depth 3, media collected at this level, deeper truncated',
					media: {
						photos: [{ url: 'https://pbs.twimg.com/deep3.jpg' }],
					},
				},
			},
		},
	},
	thread: [{ media: { photos: [{ url: 'https://pbs.twimg.com/t1.jpg' }] } }],
}

void test('parses the payload out of a fetched markdown document', () => {
	// fetch_content renders the JSON body after any document header, before
	// the next document separator.
	const document = [
		'# FxTwitter',
		'',
		'{"status":{"text":"hi"}}',
		'',
		'---',
		'next document noise {',
	].join('\n')

	assert.deepEqual(parseFxtwitterPayload(document), {
		status: { text: 'hi' },
	})
	assert.equal(
		parseFxtwitterPayload('```json\n{"status":{"text":"hi"}}\n```'),
		undefined,
		'has to be the payload body, not a fenced copy',
	)
})

void test('unparseable documents yield no payload', () => {
	assert.equal(parseFxtwitterPayload('no json here'), undefined)
	assert.equal(parseFxtwitterPayload('{ broken'), undefined)
})

void test('collects photos, gif, video posters with labels', () => {
	const media = collectTweetMedia(STATUS_MEDIA, 99)

	assert.deepEqual(
		media.map(reference => reference.label),
		[
			'photo 1 (a chart)',
			'GIF 2',
			'video 1 poster',
			'quoted external video poster',
			'quoted mosaic',
			'quoted 2 card',
			'quoted 3 photo 1',
			'thread 1 photo 1',
		],
	)
	assert.deepEqual(
		media.map(reference => reference.url),
		[
			'https://pbs.twimg.com/p1.jpg',
			'https://pbs.twimg.com/p2.gif',
			'https://pbs.twimg.com/v1.jpg',
			'https://pbs.twimg.com/ext.jpg',
			'https://pbs.twimg.com/fallback.jpg',
			'https://pbs.twimg.com/card.jpg',
			'https://pbs.twimg.com/deep3.jpg',
			'https://pbs.twimg.com/t1.jpg',
		],
	)
})

void test('quote chains collect with depth labels and respect the depth cap', () => {
	const media = collectTweetMedia(STATUS_MEDIA, 99)

	assert.deepEqual(
		media
			.filter(reference => reference.label.startsWith('quoted'))
			.map(reference => reference.label),
		[
			'quoted external video poster',
			'quoted mosaic',
			'quoted 2 card',
			'quoted 3 photo 1',
		],
	)
})

void test('deduplicates media across the whole payload', () => {
	const payload = {
		status: {
			media: { photos: [{ url: 'https://pbs.twimg.com/dupe.jpg' }] },
		},
		quote: {
			media: { photos: [{ url: 'https://pbs.twimg.com/dupe.jpg' }] },
		},
	}

	const media = collectTweetMedia(payload, 99)

	assert.deepEqual(
		media.map(reference => reference.url),
		['https://pbs.twimg.com/dupe.jpg'],
	)
})

void test('maximumMedia truncates the collection', () => {
	const media = collectTweetMedia(STATUS_MEDIA, 2)

	assert.deepEqual(
		media.map(reference => reference.label),
		['photo 1 (a chart)', 'GIF 2'],
	)
})

void test('payloads without media collect nothing', () => {
	assert.deepEqual(collectTweetMedia({ status: { text: 'plain' } }, 9), [])
	assert.deepEqual(collectTweetMedia('not an object', 9), [])
	assert.deepEqual(collectTweetMedia(null, 9), [])
})
