import assert from 'node:assert/strict'
import test from 'node:test'

import { socialFetchContentPatch } from '../extensions/social-fetch/fetch-content-patch.ts'

void test('rewrites a single page URL and clears auth', () => {
	const patch = socialFetchContentPatch({
		url: 'https://www.instagram.com/reel/DcJNLxTs34M/',
		auth: true,
	})
	assert.equal(patch.clearAuth, true)
	assert.equal(
		patch.url,
		'https://r.jina.ai/https://www.instagram.com/reel/DcJNLxTs34M/',
	)
	assert.equal(patch.urls, undefined)
})

void test('rewrites only the social entries of a URL list', () => {
	const patch = socialFetchContentPatch({
		urls: [
			'https://www.instagram.com/reel/DcJNLxTs34M/',
			'https://x.com/ada/status/1',
			'https://example.com/nothing',
		],
	})
	assert.deepEqual(patch.urls, [
		'https://r.jina.ai/https://www.instagram.com/reel/DcJNLxTs34M/',
		'https://x.com/ada/status/1', // twitter-fetch owns this one
		'https://example.com/nothing',
	])
	assert.equal(patch.url, undefined)
	assert.equal(patch.clearAuth, true)
})

void test('leaves unrelated inputs untouched', () => {
	for (const input of [
		null,
		'text',
		42,
		{ url: 7 },
		{ urls: ['page one is_good', 13] },
		{ url: 'https://example.com/x' },
		{ urls: ['https://example.com/x'] },
	]) {
		const patch = socialFetchContentPatch(input)
		assert.equal(patch.clearAuth, false)
		assert.equal(patch.url, undefined)
		assert.equal(patch.urls, undefined)
	}
})

void test('a call already targeting the Reader stays untouched', () => {
	const readerUrl = 'https://r.jina.ai/https://www.instagram.com/reel/xyz/'
	const patch = socialFetchContentPatch({ url: readerUrl })
	assert.equal(patch.clearAuth, false)
	assert.equal(patch.url, undefined)
	assert.equal(patch.urls, undefined)
})
