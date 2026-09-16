// Inco session boundary: the only place in this config that reads Safari's
// cookie store and talks to the Inco platform console.
//
// Inco publishes no balance API - the gateway under api.inco.ai serves
// /v1/models, /v1/chat/completions, /v1/messages, /v1/responses and
// /v1/embeddings, and every billing path 404s - so their docs send you to the
// console's Usage page. That console is a Clerk-protected Next.js app; the
// balance is read by replaying the session the browser itself holds:
//
//   GET /usage                                  -> 307 handshake (Clerk)
//   GET clerk.inco.ai/v1/client/handshake?...   -> 307 back to the console
//   GET /usage   (RSC: 1 + Accept: text/html)   -> 200, layout flight payload
//
// The handshake is followed, never forged: this module walks the redirect
// chain the console handed out, with the cookies the browser stored, and keeps
// whatever cookies come back in memory only. Safari's store is read and never
// written, and the flight request asks for the payload (~40 KB) instead of the
// rendered page (~150 KB).
//
// Decorative like every other quota backend: any failure (no Safari store,
// Full Disk Access denied, signed out, network, layout drift) yields undefined
// and the strip keeps saying it has no data.

import { parseIncoBalance } from './quota-inco.ts'
import { FETCH_TIMEOUT_MS } from './quotas.ts'
import { readSafariCookies } from './safari-cookies.ts'

import type { IncoQuota } from './quota-inco.ts'

const CONSOLE_ORIGIN = 'https://platform.inco.ai'
const USAGE_PATH = '/usage'

/** Console, Clerk frontend API and cookie domain of one session. */
const CONSOLE_HOSTS = ['platform.inco.ai', 'clerk.inco.ai', 'inco.ai']

/**
 * Clerk's session cookie, present only while someone is signed in: the client
 * cookie alone also lives on a signed-out browser, so the session gates the
 * whole read.
 */
const SESSION_COOKIE = '__session'

/** Flight payload of the page instead of its rendered HTML. */
const FLIGHT_HEADERS = { RSC: '1' }

/**
 * Page navigation, not an API call: Clerk's middleware only answers a
 * handshake when the request asks for a document, and redirects to `/sign-in`
 * otherwise (verified with `RSC: 1`, which alone is enough to lose the
 * session). The two headers therefore always travel together.
 */
const NAVIGATION_HEADERS = { accept: 'text/html' }

/** Console handshake hops (two observed); a fourth means the chain is drifting. */
const MAX_HOPS = 4
const OK_STATUS = 200

/** Cookie header of one jar. */
function cookieHeader(jar: Record<string, string>): string {
	return Object.entries(jar)
		.map(([name, value]) => `${name}=${value}`)
		.join('; ')
}

/** Jar extended with one response's cookies (the jar itself is left alone). */
function withResponseCookies(
	jar: Record<string, string>,
	setCookies: string[],
): Record<string, string> {
	const merged = { ...jar }
	for (const entry of setCookies) {
		const [pair] = entry.split(';')
		const separator = pair?.indexOf('=') ?? -1
		if (!pair || separator < 1) continue
		merged[pair.slice(0, separator)] = pair.slice(separator + 1)
	}
	return merged
}

/** One console request, without following its redirect. */
async function send(
	url: string,
	jar: Record<string, string>,
): Promise<Response> {
	return fetch(url, {
		headers: {
			...NAVIGATION_HEADERS,
			...FLIGHT_HEADERS,
			cookie: cookieHeader(jar),
		},
		redirect: 'manual',
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	})
}

/**
 * The console answers in redirects until the session is fresh (its own Clerk
 * handshake), so each hop is followed with the cookies that hop handed back;
 * the page body of the first 200 ends the walk.
 */
async function followUsagePage(
	url: string,
	jar: Record<string, string>,
	hopsLeft: number,
): Promise<string | undefined> {
	if (hopsLeft <= 0) return undefined
	let response: Response
	try {
		response = await send(url, jar)
	} catch {
		return undefined
	}
	const cookies = withResponseCookies(jar, response.headers.getSetCookie())
	if (response.status === OK_STATUS) return response.text()
	const location = response.headers.get('location')
	if (!location) return undefined
	return followUsagePage(
		new URL(location, url).toString(),
		cookies,
		hopsLeft - 1,
	)
}

/**
 * Inco credits for the footer, or undefined when this machine has no console
 * session in Safari.
 */
export async function pollIncoQuotas(): Promise<IncoQuota | undefined> {
	const jar = readSafariCookies(CONSOLE_HOSTS)
	if (!jar?.[SESSION_COOKIE]) return undefined
	const page = await followUsagePage(
		`${CONSOLE_ORIGIN}${USAGE_PATH}`,
		jar,
		MAX_HOPS,
	)
	if (!page) return undefined
	return parseIncoBalance(page)
}
