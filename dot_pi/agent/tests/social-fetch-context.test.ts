import assert from 'node:assert/strict'
import test from 'node:test'

import {
	SOCIAL_AUTOFETCH_CONTEXT_MARKER,
	socialAutoFetchedContext,
} from '../extensions/social-fetch/social-context.ts'
import { rewriteSocialPageUrl } from '../extensions/social-fetch/social-url.ts'

const MAX_AUTOFETCHED_PAGES = 3

const READER_URL = rewriteSocialPageUrl(
	'https://www.instagram.com/reel/DcJNLxTs34M/',
)
assert.ok(READER_URL)

/** One small but realistic Jina Reader page render. */
function render(capText: string): string {
	const profilePicture =
		'[![s4.codes profile picture](https://scontent.cdninstagram.com/a.jpg?oh=longtoken)]' +
		'(https://www.instagram.com/s4.codes/)'
	return [
		`Title: Asfar Ali on Instagram: "${capText}"`,
		'',
		'URL Source: https://www.instagram.com/reel/DcJNLxTs34M/',
		'',
		'Markdown Content:',
		profilePicture,
		'',
		capText,
		'',
		'[s4.codes](https://www.instagram.com/s4.codes/)',
		'',
		'Nice 🙌',
	].join('\n')
}

/** The URL the fetch targets, whatever the fetch toolkit passed in. */
function fetchUrlOf(input: string | URL | Request): string {
	if (typeof input === 'string') return input
	if (input instanceof URL) return input.href
	return input.url
}

function fakeFetcher(bodies: Record<string, string>): typeof fetch {
	return async input => {
		const url = fetchUrlOf(input)
		const body = bodies[url]
		if (body === undefined) {
			return new Response('not found', { status: 404 })
		}
		return new Response(body, {
			status: 200,
			headers: { 'content-type': 'text/plain' },
		})
	}
}

void test('a prompt mentioning one reel embeds its rendered context', async () => {
	const context = await socialAutoFetchedContext(
		'summarize https://www.instagram.com/reel/DcJNLxTs34M/ thanks',
		fakeFetcher({
			[READER_URL]: render('Build the world, run the action.'),
		}),
	)

	assert.ok(context?.startsWith(`\n\n${SOCIAL_AUTOFETCH_CONTEXT_MARKER}\n`))
	assert.match(context ?? '', /untrusted external data/)
	assert.match(context ?? '', /original photos, videos and audio/)
	assert.match(context ?? '', /^[^\n]*\/reel\/DcJNLxTs34M\//m)
	assert.match(context ?? '', /Build the world, run the action\./)
	assert.match(context ?? '', /\(image: s4\.codes profile picture\)/)
	assert.match(context ?? '', /Nice 🙌/)
	assert.doesNotMatch(context ?? '', /scontent\.cdninstagram\.com/)
	assert.doesNotMatch(context ?? '', /longtoken/)
})

void test('failed fetches and noisy-empty renders are skipped', async () => {
	assert.equal(
		await socialAutoFetchedContext(
			'https://www.instagram.com/reel/DcJNLxTs34M/',
			fakeFetcher({}),
		),
		undefined,
	)
	assert.equal(
		await socialAutoFetchedContext(
			'https://www.instagram.com/reel/DcJNLxTs34M/',
			fakeFetcher({ [READER_URL]: '' }),
		),
		undefined,
	)
})

void test('pages cap at the limit and long renders carry a truncation marker', async () => {
	const pageUrls = ['a', 'b', 'c', 'd'].map(
		page =>
			`https://www.instagram.com/reel/DcJNLxTs34M/?page=${page} mid-${page}`,
	)
	const bodies: Record<string, string> = {}
	for (const pageUrl of pageUrls.slice(0, MAX_AUTOFETCHED_PAGES)) {
		const pageUrlOnly = pageUrl.split(' ')[0] ?? ''
		const readerUrl = rewriteSocialPageUrl(pageUrlOnly)
		assert.ok(readerUrl)
		bodies[readerUrl] =
			pageUrlOnly === pageUrls[0]?.split(' ')[0]
				? 'x'.repeat(20_000)
				: `short render ${pageUrl}`
	}
	const context = await socialAutoFetchedContext(
		pageUrls.join(' '),
		fakeFetcher(bodies),
	)

	assert.ok(context)
	assert.equal(
		(context.match(/\/\/---/g) ?? []).length,
		MAX_AUTOFETCHED_PAGES,
	)
	assert.match(context, /…\(truncated\)/)
	assert.match(context, /short render .*page=b/)
})
