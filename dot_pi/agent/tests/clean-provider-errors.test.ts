import assert from 'node:assert/strict'
import test from 'node:test'

import { sanitizeProviderError } from '../extensions/clean-provider-errors/sanitize.ts'

const HINT_TAIL =
	' (gateway error page from the model provider - server-side outage, not caused by the request; retry or switch model)'

/** The nginx default error page, body as returned by api.inco.ai on 502. */
const NGINX_502 =
	'<html>\n<head><title>502 Bad Gateway</title></head>\n<body>\n<center><h1>502 Bad Gateway</h1></center>\n</body>\n</html>\n'

test('nginx 502 page with status prefix collapses to title, prefix deduped', () => {
	const { text, hadHtmlPage } = sanitizeProviderError(`502 ${NGINX_502}`)
	assert.equal(hadHtmlPage, true)
	assert.equal(text, `502 Bad Gateway${HINT_TAIL}`)
})

test('formatter prefix with colon is stripped and deduped against the title', () => {
	const { text, hadHtmlPage } = sanitizeProviderError(
		`502: <!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body>upstream</body></html>`,
	)
	assert.equal(hadHtmlPage, true)
	assert.equal(text, `502 Bad Gateway${HINT_TAIL}`)
})

test('status only in the prefix is kept when the title lacks it', () => {
	const { text } = sanitizeProviderError(
		`504: <html><head><title>Gateway Timeout</title></head></html>`,
	)
	assert.equal(text, `504 Gateway Timeout${HINT_TAIL}`)
})

test('falls back to h1 with inner tags stripped when there is no title', () => {
	const { text } = sanitizeProviderError(
		`502 <html><body><center><h1>502 <b>Bad</b> Gateway</h1></center></body></html>`,
	)
	assert.equal(text, `502 Bad Gateway${HINT_TAIL}`)
})

test('HTML page without title or h1 keeps the status prefix as context', () => {
	const { text, hadHtmlPage } = sanitizeProviderError(
		`503 <html><body>maintenance</body></html>`,
	)
	assert.equal(hadHtmlPage, true)
	assert.equal(text, `503 unreadable error page${HINT_TAIL}`)
})

test('plain JSON provider errors pass through untouched', () => {
	const raw = `500: {"error":{"message":"boom","code":"internal_error"}}`
	const { text, hadHtmlPage } = sanitizeProviderError(raw)
	assert.equal(hadHtmlPage, false)
	assert.equal(text, raw)
})

test('empty message passes through untouched', () => {
	const { text, hadHtmlPage } = sanitizeProviderError('')
	assert.equal(hadHtmlPage, false)
	assert.equal(text, '')
})

test('encoded entities in the page title are decoded', () => {
	const { text } = sanitizeProviderError(
		`<html><head><title>503 &#39;upstream&quot;s fault&quot;</title></head></html>`,
	)
	assert.equal(text, `503 'upstream"s fault"${HINT_TAIL}`)
})

test('HTML detection fires anywhere in the message, not only at the start', () => {
	const { hadHtmlPage } = sanitizeProviderError(
		`Provider request failed after 3 attempts: <html lang="en"><head><title>502 Bad Gateway</title></head></html>`,
	)
	assert.equal(hadHtmlPage, true)
})
