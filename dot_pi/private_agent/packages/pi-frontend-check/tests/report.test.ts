import assert from 'node:assert/strict'
import { test } from 'node:test'

import { boundedText, BrowserLog, normalizeUrl } from '../extensions/report.ts'

test('resolves relative HTML paths against the session cwd, not a fake HTTP host', () => {
	assert.equal(
		normalizeUrl('./preview #1.html', '/tmp/project'),
		'file:///tmp/project/preview%20%231.html',
	)
})

test('accepts IPv6 loopback shorthand without mistaking it for a URL scheme', () => {
	assert.equal(
		normalizeUrl('[::1]:5173/demo', '/tmp'),
		'http://[::1]:5173/demo',
	)
})

test('preserves error counts when the ring buffer evicts the original error', () => {
	const log = new BrowserLog(1)
	log.record({ kind: 'pageerror', level: 'error', text: 'crash' })
	log.record({ kind: 'console', level: 'info', text: 'later noise' })
	assert.match(log.summary(), /1 error\(s\)/)
	assert.match(log.format(), /older entries evicted/)
	assert.doesNotMatch(log.format(), /crash/)
	log.clear()
	assert.match(log.summary(), /0 error\(s\)/)
})

test('bounds multibyte single-line output and reports truncation', () => {
	const preview = boundedText('🦁'.repeat(1000), 100)
	assert.ok(Buffer.byteLength(preview) < 200)
	assert.match(preview, /truncated/)
})

test('rejects executable URL schemes and credentials', () => {
	assert.throws(
		() => normalizeUrl('javascript:alert(1)', '/tmp'),
		/Unsupported/,
	)
	assert.throws(
		() => normalizeUrl('http://user:secret@localhost:3000', '/tmp'),
		/credentials/,
	)
})
