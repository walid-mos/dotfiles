import assert from 'node:assert/strict'
import test from 'node:test'

import {
	fetchMediaBytes,
	isAllowedMediaUrl,
} from '../extensions/twitter-fetch/media-download.ts'

const ABYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x11])

const PIXEL_PNG = 'https://pbs.twimg.com/media/p1.png'
const REDIRECTED_PNG = 'https://pbs.twimg.com/media/p2.png'
const BLOCKED_PNG = 'https://media.example.com/pic.png'

/** Response constructor body parameter, without depending on DOM lib types. */
const PIXEL_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x11])

function pngResponse(): Response {
	return new Response(PIXEL_BYTES, {
		status: 200,
		headers: { 'content-type': 'image/png' },
	})
}

function redirectResponse(location: string): Response {
	return new Response(null, {
		status: 302,
		headers: { location },
	})
}

function fetcherOf(
	responses: (url: URL) => Response | Promise<Response>,
): typeof fetch {
	return async input => responses(new URL(input.toString()))
}

void test('media hosts are allowlisted (twimg + fxtwitter domains)', () => {
	assert.equal(isAllowedMediaUrl(new URL(PIXEL_PNG)), true)
	assert.equal(
		isAllowedMediaUrl(new URL('https://video.twimg.com/v.mp4')),
		true,
	)
	assert.equal(
		isAllowedMediaUrl(new URL('https://pbs.fxtwitter.com/a.jpg')),
		true,
	)
	assert.equal(
		isAllowedMediaUrl(new URL('https://pbs.twimg.com.evil.com/a.jpg')),
		false,
	)
	assert.equal(
		isAllowedMediaUrl(new URL('http://pbs.twimg.com/a.jpg')),
		false,
	)
	assert.equal(
		isAllowedMediaUrl(new URL('https://user:x@pbs.twimg.com/a.jpg')),
		false,
	)
})

void test('downloads image bytes with their mime type', async () => {
	const download = await fetchMediaBytes(
		PIXEL_PNG,
		undefined,
		fetcherOf(() => pngResponse()),
	)

	assert.deepEqual(download, {
		isSuccess: true,
		bytes: ABYTES,
		mimeType: 'image/png',
	})
})

void test('follows manual redirects only to allowed hosts', async () => {
	const hops: string[] = []
	const download = await fetchMediaBytes(
		PIXEL_PNG,
		undefined,
		fetcherOf(url => {
			hops.push(url.toString())
			return url.pathname === '/media/p1.png'
				? redirectResponse(REDIRECTED_PNG)
				: pngResponse()
		}),
	)

	assert.ok(download.isSuccess)
	assert.deepEqual(hops, [PIXEL_PNG, REDIRECTED_PNG])
})

void test('redirects to blocked hosts fail loudly', async () => {
	const download = await fetchMediaBytes(
		PIXEL_PNG,
		undefined,
		fetcherOf(() => redirectResponse(BLOCKED_PNG)),
	)

	assert.deepEqual(download, {
		isSuccess: false,
		error: 'blocked redirect host media.example.com',
	})
})

void test('redirect loops stop at the hop limit', async () => {
	const download = await fetchMediaBytes(
		PIXEL_PNG,
		undefined,
		fetcherOf(url =>
			url.pathname === '/media/p2.png'
				? redirectResponse(PIXEL_PNG)
				: redirectResponse(REDIRECTED_PNG),
		),
	)

	assert.deepEqual(download, {
		isSuccess: false,
		error: 'too many redirects',
	})
})

void test('http errors become failures with the status', async () => {
	const download = await fetchMediaBytes(
		PIXEL_PNG,
		undefined,
		fetcherOf(() => new Response('nope', { status: 404 })),
	)

	assert.deepEqual(download, { isSuccess: false, error: 'HTTP 404' })
})

void test('non-image content types are refused', async () => {
	const download = await fetchMediaBytes(
		PIXEL_PNG,
		undefined,
		fetcherOf(
			() =>
				new Response('<svg/>', {
					status: 200,
					headers: { 'content-type': 'image/svg+xml' },
				}),
		),
	)

	assert.deepEqual(download, {
		isSuccess: false,
		error: 'unsupported type image/svg+xml',
	})
})

void test('bodies beyond the size budget fail instead of buffering', async () => {
	const big = new Uint8Array(9 * 1024 * 1024)
	big.set(ABYTES, 0)
	const download = await fetchMediaBytes(
		PIXEL_PNG,
		undefined,
		fetcherOf(
			() =>
				new Response(big, {
					status: 200,
					headers: { 'content-type': 'image/png' },
				}),
		),
	)

	assert.deepEqual(download, {
		isSuccess: false,
		error: 'response too large',
	})
})

void test('blocked initial hosts fail before any request', async () => {
	const download = await fetchMediaBytes(
		BLOCKED_PNG,
		undefined,
		fetcherOf(() => pngResponse()),
	)

	assert.deepEqual(download, {
		isSuccess: false,
		error: `request failed: blocked host media.example.com`,
	})
})
