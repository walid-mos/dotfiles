// Chromium cookie store reader for the Nebius console session (macOS).
//
// The footer owns this minimal reader instead of importing pi-web-access's
// fuller one (multi-platform, all browsers): extensions/AGENTS.md restricts
// extension imports to pi-* packages and node builtins, and pi-web-access
// ships untyped-to-us .ts sources that fail this repo's type-check. Format is
// the stable Chromium one, so the reader stays small:
//
//   Cookies DB  -> AES-128-CBC values, key = PBKDF2-SHA1(password, 'saltysalt',
//                  1003, 16), IV = 16 spaces, PKCS#7 padding, then a 32-byte
//                  host hash prefix ('v10' scheme; 'v20' app-bound values are
//                  not supported and simply yield no cookie).
//   password    -> `security find-generic-password -w -s "<Browser> Safe Storage"`
//
// Nothing here throws: an unreadable store means "this machine has no console
// session", which the footer renders as missing quota data.

import { execFileSync } from 'node:child_process'
import { createDecipheriv, pbkdf2Sync } from 'node:crypto'
import {
	copyFileSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	statSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

/** macOS user-data roots and Keychain entries of the Chromium families. */
const BROWSER_STORES: Record<
	string,
	{ root: string; keychainService: string; keychainAccount: string }
> = {
	brave: {
		root: 'BraveSoftware/Brave-Browser',
		keychainService: 'Brave Safe Storage',
		keychainAccount: 'Brave',
	},
	chrome: {
		root: 'Google/Chrome',
		keychainService: 'Chrome Safe Storage',
		keychainAccount: 'Chrome',
	},
	chromium: {
		root: 'Chromium',
		keychainService: 'Chromium Safe Storage',
		keychainAccount: 'Chromium',
	},
	helium: {
		root: 'net.imput.helium',
		keychainService: 'Helium Storage Key',
		keychainAccount: 'Helium',
	},
	arc: {
		root: 'Arc/User Data',
		keychainService: 'Arc Safe Storage',
		keychainAccount: 'Arc',
	},
	edge: {
		root: 'Microsoft Edge',
		keychainService: 'Microsoft Edge Safe Storage',
		keychainAccount: 'Microsoft Edge',
	},
}

/** Chromium's legacy key derivation constants, unchanged since 2013. */
const PBKDF2_SALT = 'saltysalt'
const PBKDF2_ITERATIONS = 1003
const KEY_BYTES = 16
const CIPHER = 'aes-128-cbc'
const IV_LENGTH = 16
const IV_FILLER = 0x20

/** Scheme tag of a cookie value (`v10`, `v20`, ...). */
const SCHEME_LENGTH = 3
const SUPPORTED_SCHEME = 'v10'

/** SHA-256 host hash prefixed to every decrypted cookie value. */
const HOST_HASH_BYTES = 32

/** Chromium counts microseconds from 1601-01-01; epoch seconds from 1970. */
const CHROMIUM_EPOCH_OFFSET_SECONDS = 11_644_473_600
const MICROSECONDS_PER_SECOND = 1_000_000

const MS_PER_SECOND = 1000
const SQLITE_FIELD_SEPARATOR = '\t'

/** Cookie rows of one store, as `name<TAB>hex<TAB>expires_utc`. */
type CookieRow = { name: string; value: string }

/** Profile directories that actually hold a cookie database. */
function profileDirectories(root: string): string[] {
	let entries: string[]
	try {
		entries = readdirSync(root)
	} catch {
		return []
	}
	return entries
		.filter(entry => {
			try {
				return statSync(join(root, entry, 'Cookies')).isFile()
			} catch {
				return false
			}
		})
		.toSorted((left, right) => {
			// The signed-in default profile wins; the rest stay stable.
			if (left === 'Default') return -1
			if (right === 'Default') return 1
			return left.localeCompare(right)
		})
		.map(entry => join(root, entry, 'Cookies'))
}

function keychainPassword(store: {
	keychainService: string
	keychainAccount: string
}): string | undefined {
	try {
		const password = execFileSync(
			'security',
			[
				'find-generic-password',
				'-w',
				'-s',
				store.keychainService,
				'-a',
				store.keychainAccount,
			],
			{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
		)
		const trimmed = password.trim()
		if (!trimmed.length) return undefined
		return trimmed
	} catch {
		return undefined
	}
}

/** SQL literal for one host key; the inputs are constants from this config. */
function sqlLiteral(text: string): string {
	return `'${text.replace(/'/g, "''")}'`
}

/** Host keys a browser cookie may carry: exact and domain-wide. */
function hostKeys(host: string): string[] {
	return [host, `.${host}`]
}

function cookieRows(
	databasePath: string,
	hosts: string[],
	key: Buffer,
): CookieRow[] {
	const hostFilter = hosts
		.flatMap(host => hostKeys(host))
		.map(sqlLiteral)
		.join(', ')
	const query =
		`select name, hex(encrypted_value), expires_utc from cookies ` +
		`where host_key in (${hostFilter})`
	let output: string
	try {
		output = execFileSync(
			'sqlite3',
			[
				'-readonly',
				'-separator',
				SQLITE_FIELD_SEPARATOR,
				databasePath,
				query,
			],
			{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
		)
	} catch {
		return []
	}
	const rows: CookieRow[] = []
	for (const line of output.split('\n')) {
		if (!line.length) continue
		const [name, hex, expires] = line.split(SQLITE_FIELD_SEPARATOR)
		if (!name || !hex || !hex.length) continue
		if (isExpired(expires)) continue
		const cookieValue = decryptValue(hex, key)
		if (cookieValue) rows.push({ name, value: cookieValue })
	}
	return rows
}

/** Chromium expiry as epoch microseconds; 0 means a session cookie. */
function isExpired(expiresUtc: string | undefined): boolean {
	const micros = Number(expiresUtc)
	if (!Number.isFinite(micros) || micros <= 0) return false
	const seconds =
		micros / MICROSECONDS_PER_SECOND - CHROMIUM_EPOCH_OFFSET_SECONDS
	return seconds * MS_PER_SECOND < Date.now()
}

/** AES-128-CBC value of one cookie, or undefined for an unsupported scheme. */
function decryptValue(hex: string, key: Buffer): string | undefined {
	const encrypted = Buffer.from(hex, 'hex')
	if (encrypted.length <= SCHEME_LENGTH) return undefined
	const scheme = encrypted.subarray(0, SCHEME_LENGTH).toString('latin1')
	// 'v20' is the app-bound scheme: only the browser process can read it.
	if (scheme !== SUPPORTED_SCHEME) return undefined
	return decryptV10(encrypted.subarray(SCHEME_LENGTH), key)
}

let derivationCache: { password: string; key: Buffer } | undefined

/** PBKDF2 key of the browser's Keychain password (cached per password). */
function derivationKey(password: string): Buffer {
	if (derivationCache?.password === password) return derivationCache.key
	const key = pbkdf2Sync(
		password,
		PBKDF2_SALT,
		PBKDF2_ITERATIONS,
		KEY_BYTES,
		'sha1',
	)
	derivationCache = { password, key }
	return key
}

let keyCache: { browser: string; key: Buffer } | undefined

/** Key of one browser, read from the Keychain on first use. */
function browserKey(
	browser: string,
	store: { keychainService: string; keychainAccount: string },
): Buffer | undefined {
	if (keyCache?.browser === browser) return keyCache.key
	const password = keychainPassword(store)
	if (!password) return undefined
	const key = derivationKey(password)
	keyCache = { browser, key }
	return key
}

function decryptV10(payload: Buffer, key: Buffer): string | undefined {
	try {
		const decipher = createDecipheriv(
			CIPHER,
			key,
			Buffer.alloc(IV_LENGTH, IV_FILLER),
		)
		decipher.setAutoPadding(true)
		const plain = Buffer.concat([
			decipher.update(payload),
			decipher.final(),
		])
		const cookieValue = plain.subarray(
			plain.length >= HOST_HASH_BYTES ? HOST_HASH_BYTES : 0,
		)
		return cookieValue.toString('utf8')
	} catch {
		return undefined
	}
}

/**
 * Cookie rows of one profile database, read through a private copy: the
 * browser holds the original open. A locked or unreadable store is empty.
 */
function readProfileCookies(
	databasePath: string,
	hosts: string[],
	key: Buffer,
): CookieRow[] {
	const scratch = mkdtempSync(join(tmpdir(), 'pi-nebius-cookies-'))
	const copy = join(scratch, 'Cookies')
	try {
		copyFileSync(databasePath, copy)
		return cookieRows(copy, hosts, key)
	} catch {
		return []
	} finally {
		rmSync(scratch, { recursive: true, force: true })
	}
}

/**
 * Decrypted cookies for the given hosts out of one Chromium browser, or
 * undefined when that browser has no readable store.
 */
export function readBrowserCookies(
	browser: string,
	hosts: string[],
): Record<string, string> | undefined {
	const store = BROWSER_STORES[browser]
	if (!store) return undefined
	const root = join(homedir(), 'Library', 'Application Support', store.root)
	const databases = profileDirectories(root)
	if (!databases.length) return undefined
	const key = browserKey(browser, store)
	if (!key) return undefined
	const cookies: Record<string, string> = {}
	for (const databasePath of databases) {
		for (const row of readProfileCookies(databasePath, hosts, key)) {
			cookies[row.name] = row.value
		}
	}
	if (!Object.keys(cookies).length) return undefined
	return cookies
}
