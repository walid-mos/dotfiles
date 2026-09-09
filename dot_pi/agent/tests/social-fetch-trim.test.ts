import assert from 'node:assert/strict'
import test from 'node:test'

import { trimReaderMarkdown } from '../extensions/social-fetch/reader-trim.ts'

void test('collapses media anchors to alt-text placeholders', () => {
	const markdown = [
		'[![s4.codes profile picture](https://cdn.example/a.jpg?x=1)](https://www.instagram.com/s4.codes/)',
		'',
		'![shot of a cat](https://cdn.example/b.jpg?x=2)',
		'',
		'![](https://cdn.example/c.jpg)',
	].join('\n')
	assert.equal(
		trimReaderMarkdown(markdown, 4_000),
		[
			'(image: s4.codes profile picture)',
			'',
			'(image: shot of a cat)',
			'',
			'(image)',
		].join('\n'),
	)
})

void test('keeps short link hrefs, drops long ones', () => {
	assert.equal(
		trimReaderMarkdown(
			'[s4.codes](https://www.instagram.com/s4.codes/) short',
			4_000,
		),
		'[s4.codes](https://www.instagram.com/s4.codes/) short',
	)
	const longHref = `https://cdn.example/${'x'.repeat(200)}`
	assert.equal(
		trimReaderMarkdown(`[bio](<${longHref}>) end`, 4_000),
		'[bio] end',
	)
})

void test('collapses blank runs and peaks at the cap with a marker', () => {
	const markdown = 'a\n\n\n\n\nb'
	assert.equal(trimReaderMarkdown(markdown, 4_000), 'a\n\nb')
	assert.equal(trimReaderMarkdown('word '.repeat(3_000), 100).length, 100)
	assert.match(
		trimReaderMarkdown('word '.repeat(3_000), 100),
		/…\(truncated\)$/,
	)
})

void test('leaves plain prose untouched', () => {
	const markdown =
		'Title: Asfar Ali on Instagram: "Build the world."\n\nMarkdown Content:\nNice 🙌'
	assert.equal(trimReaderMarkdown(markdown, 4_000), markdown)
})
