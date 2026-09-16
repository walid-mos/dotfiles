// Nebius session boundary: the only place in this config that reads the
// browser session and talks to the console's private billing gateway.
//
// Nebius publishes no balance API (checked against both OpenAPI specs, the
// proto surface and their docs), so the console BFF is the only source. It
// wants the browser session cookie plus a double-submit CSRF token, which is
// why this module depends on nebius-cookies.ts for the session jar.
//
// Verified chain (every call POST, captured from the console itself):
//   GET  /api/csrf-token                                    -> { csrfToken }
//   POST /api-mfe/billing/gateway/root/iam/getAiTenants     -> tenant
//   POST .../customers/getBillingEntitiesCreationStatus     -> customer + contract
//   POST .../customers/getBalance                           -> { balance }
//   POST .../billingActs/getCurrentTrial                    -> trial window
//
// Decorative like every other quota backend: any failure (no browser, no
// session, logged out, network, gateway drift) yields undefined and the strip
// keeps saying it has no data.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { isRecord } from './json.ts'
import { readBrowserCookies } from './nebius-cookies.ts'
import { nebiusQuota } from './quota-nebius.ts'
import { FETCH_TIMEOUT_MS } from './quotas.ts'

import type { NebiusQuota } from './quota-nebius.ts'

const CONSOLE_ORIGIN = 'https://tokenfactory.nebius.com'
const GATEWAY_BASE = `${CONSOLE_ORIGIN}/api-mfe/billing/gateway/root`
const CSRF_URL = `${CONSOLE_ORIGIN}/api/csrf-token`

/** Session and CSRF cookies live on the console host only. */
const COOKIE_HOSTS = ['tokenfactory.nebius.com']
const SESSION_COOKIE = '__Host-app_session'
const CSRF_COOKIE = '__Host-psifi.x-csrf-token'

/** Browser of the signed-in console session, as declared for the web tools. */
const WEB_SEARCH_CONFIG = join(homedir(), '.pi', 'web-search.json')
const FALLBACK_BROWSER = 'brave'

/** One console page of tenants is enough for an account's own tenant. */
const TENANT_PAGE_SIZE = 100

type NebiusSession = {
	cookies: Record<string, string>
	csrfToken: string
}

/** CSRF cookie of a response, when it carries one: header and cookie must match. */
function csrfCookieOf(
	setCookies: string[],
): { name: string; value: string } | undefined {
	for (const entry of setCookies) {
		const [pair] = entry.split(';')
		const separator = pair?.indexOf('=') ?? -1
		if (!pair || separator < 1) continue
		const name = pair.slice(0, separator)
		if (name !== CSRF_COOKIE) continue
		return { name, value: pair.slice(separator + 1) }
	}
	return undefined
}

/** Cookie header value for one jar. */
function cookieHeader(cookies: Record<string, string>): string {
	return Object.entries(cookies)
		.map(([name, value]) => `${name}=${value}`)
		.join('; ')
}

/**
 * Browser the user browses the console with: the one already configured for
 * browser-cookie reads (`browserCookies.browser` in ~/.pi/web-search.json),
 * so the two never drift.
 */
function configuredBrowser(): string {
	try {
		const config: unknown = JSON.parse(
			readFileSync(WEB_SEARCH_CONFIG, 'utf8'),
		)
		if (!isRecord(config)) return FALLBACK_BROWSER
		const { browserCookies } = config
		if (!isRecord(browserCookies)) return FALLBACK_BROWSER
		const { browser } = browserCookies
		if (typeof browser !== 'string' || !browser.length)
			return FALLBACK_BROWSER
		return browser
	} catch {
		return FALLBACK_BROWSER
	}
}

/**
 * Console cookies out of the local browser. An absent session is a normal
 * state (nebius-cookies.ts returns undefined rather than throwing), and
 * without the session cookie every gateway call is an anonymous failure.
 */
function readConsoleCookies(): Record<string, string> | undefined {
	const cookies = readBrowserCookies(configuredBrowser(), COOKIE_HOSTS)
	if (!cookies) return undefined
	if (!cookies[SESSION_COOKIE]) return undefined
	return cookies
}

/** CSRF pair of the current session: header token and cookie travel together. */
async function fetchCsrfToken(
	cookies: Record<string, string>,
): Promise<string | undefined> {
	const jar = { ...cookies }
	try {
		const response = await fetch(CSRF_URL, {
			headers: { cookie: cookieHeader(jar), accept: 'application/json' },
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		})
		if (!response.ok) return undefined
		const csrfCookie = csrfCookieOf(response.headers.getSetCookie())
		if (csrfCookie) jar[csrfCookie.name] = csrfCookie.value
		const payload: unknown = await response.json()
		if (!isRecord(payload)) return undefined
		const { csrfToken } = payload
		if (typeof csrfToken !== 'string' || !csrfToken.length) return undefined
		return csrfToken
	} catch {
		return undefined
	}
}

/** Session cookies plus a CSRF token; undefined when either half is missing. */
async function openSession(): Promise<NebiusSession | undefined> {
	const cookies = readConsoleCookies()
	if (!cookies) return undefined
	const csrfToken = await fetchCsrfToken(cookies)
	if (!csrfToken) return undefined
	return { cookies, csrfToken }
}

/** One gateway method; undefined on any transport, HTTP or payload failure. */
async function gatewayCall(
	session: NebiusSession,
	method: string,
	body: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
	const { cookies, csrfToken } = session
	try {
		const response = await fetch(`${GATEWAY_BASE}/${method}`, {
			method: 'POST',
			headers: {
				cookie: cookieHeader(cookies),
				'x-csrf-token': csrfToken,
				'x-requested-with': 'XMLHttpRequest',
				'content-type': 'application/json',
				accept: 'application/json',
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		})
		if (!response.ok) return undefined
		const payload: unknown = await response.json()
		if (!isRecord(payload)) return undefined
		return payload
	} catch {
		return undefined
	}
}

function objectField(
	container: Record<string, unknown>,
	key: string,
): Record<string, unknown> | undefined {
	const field = container[key]
	if (!isRecord(field)) return undefined
	return field
}

function stringField(
	container: Record<string, unknown>,
	key: string,
): string | undefined {
	const field = container[key]
	if (typeof field !== 'string' || !field.length) return undefined
	return field
}

/** Tenant of the account, as the console picks it: the first one listed. */
function firstTenantId(tenants: Record<string, unknown>): string | undefined {
	const { items } = tenants
	if (!Array.isArray(items) || !items.length) return undefined
	const [first] = items
	if (!isRecord(first)) return undefined
	const metadata = objectField(first, 'metadata')
	if (!metadata) return undefined
	return stringField(metadata, 'id')
}

/** Contract id of the tenant's billing entities, from a gateway answer. */
function contractIdOf(entities: Record<string, unknown>): string | undefined {
	const billingEntities = objectField(entities, 'billingEntities')
	if (!billingEntities) return undefined
	return stringField(billingEntities, 'contractId')
}

/** Balance plus trial over one session; undefined if either leg is down. */
async function readQuota(
	session: NebiusSession,
): Promise<NebiusQuota | undefined> {
	const tenants = await gatewayCall(session, 'iam/getAiTenants', {
		pageSize: TENANT_PAGE_SIZE,
	})
	if (!tenants) return undefined
	const tenantId = firstTenantId(tenants)
	if (!tenantId) return undefined
	const entities = await gatewayCall(
		session,
		'customers/getBillingEntitiesCreationStatus',
		{ tenantId },
	)
	if (!entities) return undefined
	const contractId = contractIdOf(entities)
	if (!contractId) return undefined
	const balance = await gatewayCall(session, 'customers/getBalance', {
		contractId,
	})
	if (!balance) return undefined
	const trial = await gatewayCall(session, 'billingActs/getCurrentTrial', {
		parentId: contractId,
	})
	return nebiusQuota(balance, trial)
}

/**
 * Nebius credits for the footer, or undefined when this machine has no console
 * session. A session rotated by a fresh login gets one re-read.
 */
export async function pollNebiusQuotas(): Promise<NebiusQuota | undefined> {
	const session = await openSession()
	if (!session) return undefined
	const quota = await readQuota(session)
	if (quota) return quota
	const rotated = await openSession()
	if (!rotated) return undefined
	return readQuota(rotated)
}
