import assert from 'node:assert/strict'
import test from 'node:test'

import {
	fetchContentPatch,
	fetchContentUrls,
} from '../extensions/twitter-fetch/fetch-content-patch.ts'
import {
	statusApiUrl,
	statusIdFromUrl,
	statusIdsInText,
	rewriteTwitterStatusUrl,
} from '../extensions/twitter-fetch/status-url.ts'
import { isFxTwitterApiUrl } from '../extensions/twitter-fetch/status-url.ts'

void test('extracts status ids from every host and path shape', () => {
	assert.equal(statusIdFromUrl('https://x.com/user/status/1234'), '1234')
	assert.equal(
		statusIdFromUrl('https://twitter.com/user/status/1234'),
		'1234',
	)
	assert.equal(
		statusIdFromUrl('https://mobile.twitter.com/user/status/1234?s=20'),
		'1234',
	)
	assert.equal(statusIdFromUrl('https://x.com/i/web/status/1234'), '1234')
	assert.equal(statusIdFromUrl('https://x.com/i/status/1234'), '1234')
	assert.equal(statusIdFromUrl('x.com/user/statuses/1234'), undefined)
	assert.equal(
		statusIdFromUrl('https://example.com/x/status/1234'),
		undefined,
	)
	assert.equal(
		statusIdFromUrl('https://user:x@x.com/user/status/1234'),
		undefined,
	)
	assert.equal(statusIdFromUrl(null), undefined)
})

void test('rewrites original status URLs onto the FxTwitter API', () => {
	assert.equal(
		rewriteTwitterStatusUrl('https://x.com/user/status/1234'),
		statusApiUrl('1234'),
	)
	assert.equal(
		rewriteTwitterStatusUrl('https://api.fxtwitter.com/2/status/1234'),
		undefined,
		'API URLs are already rewritten; no second hop',
	)
})

void test('scans messages for unique status ids with a cap', () => {
	const prompt = [
		'https://x.com/a/status/111',
		'read https://twitter.com/b/status/222 as well',
		'duplicate https://x.com/a/status/111 mentions',
		'https://example.com/nothing',
	].join('\n')

	assert.deepEqual(statusIdsInText(prompt, 10), ['111', '222'])
	assert.deepEqual(
		statusIdsInText(`${prompt}\nhttps://x.com/c/status/333`, 2),
		['111', '222'],
		'attention stays capped at the requested count',
	)
})

void test('recognizes this extension API endpoints only', () => {
	assert.equal(isFxTwitterApiUrl(statusApiUrl('1234')), true)
	assert.equal(
		isFxTwitterApiUrl(`${statusApiUrl('1234')}?format=json`),
		true,
		"queries don't change the endpoint path",
	)
	assert.equal(
		isFxTwitterApiUrl('https://api.fxtwitter.com/2/status/abc'),
		false,
	)
	assert.equal(isFxTwitterApiUrl('https://evil.com/2/status/1234'), false)
	assert.equal(isFxTwitterApiUrl('::nope'), false)
})

void test('patches fetch_content inputs that target status URLs', () => {
	const patch = fetchContentPatch({
		url: 'https://x.com/user/status/1234',
		auth: 'token',
	})

	assert.equal(patch.url, statusApiUrl('1234'))
	assert.equal(patch.clearAuth, true)
})

void test('rewrites individual entries of a urls list', () => {
	const patch = fetchContentPatch({
		urls: ['https://x.com/a/status/111', 'https://example.com/page'],
	})

	assert.deepEqual(patch.urls, [
		statusApiUrl('111'),
		'https://example.com/page',
	])
	assert.equal(patch.clearAuth, true)
})

void test('unrelated inputs are not patched', () => {
	const patch = fetchContentPatch({ url: 'https://example.com/page' })

	assert.equal(patch.url, undefined)
	assert.equal(patch.urls, undefined)
	assert.equal(patch.clearAuth, false)
	assert.deepEqual(fetchContentPatch(null).clearAuth, false)
})

void test('gathers target URLs from input and details for detection', () => {
	assert.deepEqual(
		fetchContentUrls(
			{ url: statusApiUrl('9') },
			{ urls: [statusApiUrl('10')] },
		),
		[statusApiUrl('9'), statusApiUrl('10')],
	)
})
