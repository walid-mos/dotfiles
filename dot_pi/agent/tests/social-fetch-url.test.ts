import assert from 'node:assert/strict'
import test from 'node:test'

import {
	isSocialPageUrl,
	rewriteSocialPageUrl,
	socialUrlsInText,
} from '../extensions/social-fetch/social-url.ts'

void test('extracts instagram reel URLs even wrapped in text', () => {
	const urls = socialUrlsInText(
		'See https://www.instagram.com/reel/DcJNLxTs34M/. More below.',
		3,
	)
	assert.deepEqual(urls, ['https://www.instagram.com/reel/DcJNLxTs34M/'])
})

void test('extracts bare, mobile and shortener hosts', () => {
	const urls = socialUrlsInText(
		[
			'instagram.com/p/DcJNLxTs34M ok',
			'https://m.instagram.com/reel/DcJNLxTs34M/',
			'https://vm.tiktok.com/ZMabc123/',
			'https://www.threads.net/@ada/post/7gQwErTy',
			'https://instagr.am/p/DcJNLxTs34M',
		].join(' | '),
		5,
	)
	assert.deepEqual(urls, [
		'https://instagram.com/p/DcJNLxTs34M',
		'https://m.instagram.com/reel/DcJNLxTs34M/',
		'https://vm.tiktok.com/ZMabc123/',
		'https://www.threads.net/@ada/post/7gQwErTy',
		'https://instagr.am/p/DcJNLxTs34M',
	])
})

void test('rejects X/Twitter hosts, bare hosts and login-wall paths', () => {
	const urls = socialUrlsInText(
		'https://x.com/ada/status/111 | https://twitter.com/ada/status/222 | ' +
			'https://www.instagram.com | instagram.com/accounts/login | ' +
			'https://evil-instagram.com/p/xyz',
		10,
	)
	assert.deepEqual(urls, [])
})

void test('strips wrapped parens and deduplicates, capped', () => {
	const reel = 'https://www.instagram.com/reel/abc123/'
	const urls = socialUrlsInText(
		`(look ${reel}) and again ${reel} and https://www.tiktok.com/@ada/video/999 done.`,
		2,
	)
	assert.deepEqual(urls, [reel, 'https://www.tiktok.com/@ada/video/999'])
})

void test('recognizes every supported page shape', () => {
	for (const good of [
		'instagram.com/reel/DcJNLxTs34M/',
		'https://www.instagram.com/p/Cxyz/',
		'tiktok.com/@ada/video/111222333',
		'vm.tiktok.com/abc/',
		'threads.net/@ada/post/7gQwErTy',
		'threads.com/@ada/post/7gQwErTy',
		'instagr.am/p/Cxyz',
	]) {
		assert.equal(isSocialPageUrl(good), true, good)
	}
	for (const bad of [
		'instagram.com',
		'instagram.com/',
		'instagram.com/accounts/login',
		'instagram.com/explore/',
		'instagram.com/stories/ada/123',
		'x.com/ada/status/1',
		'aubergine.com/p/x',
	]) {
		assert.equal(isSocialPageUrl(bad), false, bad)
	}
})

void test('rewrites page URLs to their Reader endpoints', () => {
	assert.equal(
		rewriteSocialPageUrl('https://www.instagram.com/reel/DcJNLxTs34M/'),
		'https://r.jina.ai/https://www.instagram.com/reel/DcJNLxTs34M/',
	)
	assert.equal(rewriteSocialPageUrl('https://x.com/ada/status/1'), undefined)
	assert.equal(rewriteSocialPageUrl('https://instagram.com'), undefined)
})
