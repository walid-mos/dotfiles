// Safari cookie store reader for the Inco console session (macOS).
//
// The Inco console session lives in Safari, and Safari does not use the
// Chromium AES store: its cookies are the `Cookies.binarycookies` container
// format, with cleartext values.
//
//   file    ~/Library/Containers/com.apple.Safari/Data/Library/Cookies/
//           Cookies.binarycookies
//   layout  'cook', page count and page sizes as big-endian u32, then one page
//           per size: a u32 header, a little-endian cookie count, one offset
//           per cookie, and per record at pageStart + offset: the little-
//           endian offsets of the domain, name and value NUL-terminated
//           strings plus a Mac-epoch (2001-01-01) expiry double.
//
// Safari's container is protected by macOS privacy controls, so a process
// without Full Disk Access sees no file; a missing, denied or malformed store
// means "this machine has no Safari console session". No entry point throws.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const COOKIE_FILE = join(
	homedir(),
	'Library',
	'Containers',
	'com.apple.Safari',
	'Data',
	'Library',
	'Cookies',
	'Cookies.binarycookies',
)

const SIGNATURE = 'cook'
const U32_BYTES = 4
const PAGE_HEADER_BYTES = 4

/** Field offsets inside one cookie record, relative to the record start. */
const DOMAIN_OFFSET_FIELD = 16
const NAME_OFFSET_FIELD = 20
const VALUE_OFFSET_FIELD = 28
const EXPIRY_FIELD = 40

/** Safari counts seconds from 2001-01-01; epoch seconds count from 1970. */
const SAFARI_EPOCH_OFFSET_SECONDS = 978_307_200
const MS_PER_SECOND = 1000

type CookieRow = { host: string; name: string; value: string }

/** NUL-terminated string starting at one offset of the store. */
function readCString(file: Buffer, start: number): string {
	let end = start
	while (end < file.length && file[end] !== 0) end += 1
	return file.subarray(start, end).toString('utf8')
}

/** A record's expiry as a Mac-epoch double; 0 means a session cookie. */
function isExpired(expires: number): boolean {
	if (!Number.isFinite(expires) || expires <= 0) return false
	return (expires + SAFARI_EPOCH_OFFSET_SECONDS) * MS_PER_SECOND < Date.now()
}

/** Cookie records of one page, read through their record offsets. */
function pageRows(file: Buffer, pageStart: number): CookieRow[] {
	let cursor = pageStart + PAGE_HEADER_BYTES
	const cookieCount = file.readUInt32LE(cursor)
	cursor += U32_BYTES
	const offsets: number[] = []
	for (let index = 0; index < cookieCount; index += 1) {
		offsets.push(file.readUInt32LE(cursor))
		cursor += U32_BYTES
	}
	const rows: CookieRow[] = []
	for (const offset of offsets) {
		const record = pageStart + offset
		const expires = file.readDoubleLE(record + EXPIRY_FIELD)
		if (isExpired(expires)) continue
		const host = readCString(
			file,
			record + file.readUInt32LE(record + DOMAIN_OFFSET_FIELD),
		)
		const name = readCString(
			file,
			record + file.readUInt32LE(record + NAME_OFFSET_FIELD),
		)
		const cookieValue = readCString(
			file,
			record + file.readUInt32LE(record + VALUE_OFFSET_FIELD),
		)
		if (!name.length || !cookieValue.length) continue
		rows.push({ host, name, value: cookieValue })
	}
	return rows
}

/** Every live record of a store image, or none when it is not one. */
function fileRows(file: Buffer): CookieRow[] {
	if (file.subarray(0, SIGNATURE.length).toString('latin1') !== SIGNATURE) {
		return []
	}
	const pageCount = file.readUInt32BE(SIGNATURE.length)
	let cursor = SIGNATURE.length + U32_BYTES
	const pageSizes: number[] = []
	for (let index = 0; index < pageCount; index += 1) {
		pageSizes.push(file.readUInt32BE(cursor))
		cursor += U32_BYTES
	}
	const rows: CookieRow[] = []
	for (const pageSize of pageSizes) {
		rows.push(...pageRows(file, cursor))
		cursor += pageSize
	}
	return rows
}

/** A record applies to a host exactly, or domain-wide through its dot. */
function appliesTo(rowHost: string, hosts: string[]): boolean {
	if (!rowHost.startsWith('.')) return hosts.includes(rowHost)
	const domain = rowHost.slice(1)
	return hosts.some(host => host === domain || host.endsWith(rowHost))
}

/**
 * Cookies for the given hosts out of one store image. Worth its own entry
 * point: the format is what needs testing, and no test may write to the store
 * Safari is using.
 */
export function readSafariStore(
	file: Buffer,
	hosts: string[],
): Record<string, string> | undefined {
	let rows: CookieRow[]
	try {
		rows = fileRows(file)
	} catch {
		return undefined
	}
	const cookies: Record<string, string> = {}
	for (const row of rows) {
		if (!appliesTo(row.host, hosts)) continue
		cookies[row.name] = row.value
	}
	if (!Object.keys(cookies).length) return undefined
	return cookies
}

/**
 * Cookies for the given hosts out of Safari's store, or undefined when Safari
 * holds none of them (never having browsed those hosts counts as no session,
 * same as the Chromium reader's missing store).
 */
export function readSafariCookies(
	hosts: string[],
): Record<string, string> | undefined {
	try {
		return readSafariStore(readFileSync(COOKIE_FILE), hosts)
	} catch {
		return undefined
	}
}
