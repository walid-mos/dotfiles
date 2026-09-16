import assert from 'node:assert/strict'
import test from 'node:test'

import { readSafariStore } from '../extensions/footer/safari-cookies.ts'

type StoredCookie = {
	host: string
	name: string
	value: string
	/** Mac-epoch seconds (2001-01-01); 0 is a session cookie. */
	expires?: number
}

const SIGNATURE_LENGTH = 4
const U32_BYTES = 4
const PAGE_HEADER_BYTES = 4
const RECORD_HEADER_BYTES = 48
const DOMAIN_FIELD = 16
const NAME_FIELD = 20
const VALUE_FIELD = 28
const EXPIRY_FIELD = 40

/** Days between the macOS epoch (2001-01-01) and the Unix one. */
const SAFARI_EPOCH_DAYS = 11_317
const SECONDS_PER_DAY = 86_400

/** One NUL-terminated field of a record. */
function field(text: string): Buffer {
	return Buffer.concat([Buffer.from(text, 'utf8'), Buffer.from([0])])
}

/** One fixed-size record header plus the strings its offsets point at. */
function record(cookie: StoredCookie): Buffer {
	const domain = field(cookie.host)
	const name = field(cookie.name)
	const cookieValue = field(cookie.value)
	const header = Buffer.alloc(RECORD_HEADER_BYTES)
	header.writeUInt32LE(
		RECORD_HEADER_BYTES + domain.length + name.length + cookieValue.length,
		0,
	)
	header.writeUInt32LE(RECORD_HEADER_BYTES, DOMAIN_FIELD)
	header.writeUInt32LE(RECORD_HEADER_BYTES + domain.length, NAME_FIELD)
	header.writeUInt32LE(
		RECORD_HEADER_BYTES + domain.length + name.length,
		VALUE_FIELD,
	)
	header.writeDoubleLE(cookie.expires ?? 0, EXPIRY_FIELD)
	return Buffer.concat([header, domain, name, cookieValue])
}

/** A one-page store image holding the given records, in `cook` layout. */
function store(cookies: StoredCookie[]): Buffer {
	const records = cookies.map(record)
	const offsets = Buffer.alloc(cookies.length * U32_BYTES)
	let cursor = PAGE_HEADER_BYTES + U32_BYTES + offsets.length
	for (const [index, entry] of records.entries()) {
		offsets.writeUInt32LE(cursor, index * U32_BYTES)
		cursor += entry.length
	}
	const count = Buffer.alloc(U32_BYTES)
	count.writeUInt32LE(cookies.length, 0)
	const page = Buffer.concat([
		Buffer.alloc(PAGE_HEADER_BYTES),
		count,
		offsets,
		...records,
	])
	const header = Buffer.alloc(SIGNATURE_LENGTH + U32_BYTES)
	header.write('cook', 'latin1')
	header.writeUInt32BE(1, SIGNATURE_LENGTH)
	const pageSize = Buffer.alloc(U32_BYTES)
	pageSize.writeUInt32BE(page.length, 0)
	return Buffer.concat([header, pageSize, page])
}

/** Mac-epoch stamp of a day offset from today (negative is the past). */
function macDays(days: number): number {
	const unixDays = Math.floor(Date.now() / 1000 / SECONDS_PER_DAY)
	return unixDays - SAFARI_EPOCH_DAYS + days
}

void test('reads the records of a store image', () => {
	const image = store([
		{ host: 'platform.inco.ai', name: '__session', value: 'jwt' },
	])

	assert.deepEqual(readSafariStore(image, ['platform.inco.ai']), {
		__session: 'jwt',
	})
})

void test('a domain cookie reaches its host and its subdomains', () => {
	const image = store([
		{ host: '.clerk.inco.ai', name: '__client', value: 'client' },
	])

	assert.deepEqual(readSafariStore(image, ['clerk.inco.ai']), {
		__client: 'client',
	})
	assert.deepEqual(readSafariStore(image, ['other.clerk.inco.ai']), {
		__client: 'client',
	})
})

void test('cookies of other hosts stay out', () => {
	const image = store([
		{ host: 'platform.inco.ai', name: '__session', value: 'jwt' },
		{ host: '.example.com', name: 'sid', value: 'other' },
		{ host: 'inco.ai.evil.test', name: 'sid', value: 'substring match' },
	])
	const cookies = readSafariStore(image, [
		'platform.inco.ai',
		'clerk.inco.ai',
	])

	assert.deepEqual(cookies, { __session: 'jwt' })
})

void test('an expired record is dropped, a session cookie is kept', () => {
	const image = store([
		{
			host: 'platform.inco.ai',
			name: '__session',
			value: 'stale',
			expires: macDays(-1),
		},
		{ host: 'platform.inco.ai', name: 'AWSALB', value: 'live' },
	])
	const cookies = readSafariStore(image, ['platform.inco.ai'])

	assert.deepEqual(cookies, { AWSALB: 'live' })
})

void test('a store without a single matching cookie has no cookies', () => {
	const image = store([{ host: 'example.com', name: 'sid', value: 'other' }])

	assert.equal(readSafariStore(image, ['platform.inco.ai']), undefined)
})

void test('a file that is not a store yields no cookies', () => {
	for (const file of [
		Buffer.from('not a cookie store'),
		Buffer.alloc(8),
		Buffer.from('cook'),
	]) {
		assert.equal(readSafariStore(file, ['platform.inco.ai']), undefined)
	}
})
