/** Download media bytes from tweet-related CDN hosts; everything else is blocked. */

import { readBoundedBytes } from '../http/bounded-response.ts'

export type MediaBytesResult =
	| {
			readonly isSuccess: true
			readonly bytes: Uint8Array
			readonly mimeType: string
	  }
	| { readonly isSuccess: false; readonly error: string }

const IMAGE_TIMEOUT_MS = 15_000
const MAX_IMAGE_BYTES = 8_388_608
const MAX_REDIRECTS = 3

const MEDIA_HOSTS = new Set([
	'abs.twimg.com',
	'pbs.twimg.com',
	'ton.twimg.com',
	'video.twimg.com',
])
const MEDIA_HOST_SUFFIXES = [
	'.fixupx.com',
	'.fxtwitter.com',
	'.twimg.com',
	'.vxtwitter.com',
]
/** HTTP status codes treated as redirects (per RFC 7231 + 308). */
const REDIRECT_STATUS = {
	MOVED_PERMANENTLY: 301,
	FOUND: 302,
	SEE_OTHER: 303,
	TEMPORARY_REDIRECT: 307,
	PERMANENT_REDIRECT: 308,
} as const
const REDIRECT_STATUSES = new Set<number>(Object.values(REDIRECT_STATUS))
const SUPPORTED_IMAGE_TYPES = new Set([
	'image/gif',
	'image/jpeg',
	'image/png',
	'image/webp',
])

export function isAllowedMediaUrl(candidate: URL): boolean {
	const hostname = candidate.hostname.toLowerCase()
	const allowedHost =
		MEDIA_HOSTS.has(hostname) ||
		MEDIA_HOST_SUFFIXES.some(suffix => hostname.endsWith(suffix))
	return (
		candidate.protocol === 'https:' &&
		!candidate.username &&
		!candidate.password &&
		allowedHost
	)
}

/**
 * Fetch image bytes with size, type, host and redirect guards:
 * manual redirects against allowed hosts only, 15s timeout, 8 MiB cap and
 * image MIME types only.
 */
export async function fetchMediaBytes(
	rawUrl: string,
	signal: AbortSignal | undefined,
	fetcher: typeof fetch = fetch,
): Promise<MediaBytesResult> {
	try {
		const timeout = AbortSignal.timeout(IMAGE_TIMEOUT_MS)
		const requestSignal = signal
			? AbortSignal.any([signal, timeout])
			: timeout
		const initialUrl = parseAllowedMediaUrl(rawUrl)
		return await downloadMedia(initialUrl, requestSignal, fetcher)
	} catch (error) {
		const message = signal?.aborted ? 'cancelled' : 'request failed'
		return {
			error:
				error instanceof Error
					? `${message}: ${error.message}`
					: message,
			isSuccess: false,
		}
	}
}

/** Follow manual redirects (allowed hosts only), then read the final body. */
async function downloadMedia(
	initialUrl: URL,
	requestSignal: AbortSignal,
	fetcher: typeof fetch,
): Promise<MediaBytesResult> {
	let currentUrl = initialUrl
	for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
		// Redirect hops are sequential by definition.
		// oxlint-disable-next-line no-await-in-loop
		const response = await fetcher(currentUrl, {
			headers: {
				Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
				'User-Agent': 'Mozilla/5.0 (compatible; pi-twitter-fetch/1.0)',
			},
			redirect: 'manual',
			signal: requestSignal,
		})
		const redirect = redirectTarget(response, currentUrl)
		if (!redirect) return readImageResponse(response)
		if ('isSuccess' in redirect) return redirect
		currentUrl = redirect
	}
	return { error: 'too many redirects', isSuccess: false }
}

function parseAllowedMediaUrl(rawUrl: string): URL {
	let parsedUrl: URL
	try {
		parsedUrl = new URL(rawUrl)
	} catch {
		throw new Error('invalid URL')
	}
	if (!isAllowedMediaUrl(parsedUrl)) {
		throw new Error(`blocked host ${parsedUrl.hostname}`)
	}
	return parsedUrl
}

/** Next redirect hop, undefined when the response is final, or a failure. */
function redirectTarget(
	response: Response,
	currentUrl: URL,
): URL | MediaBytesResult | undefined {
	if (!REDIRECT_STATUSES.has(response.status)) return undefined
	const location = response.headers.get('location')
	if (!location) {
		return { error: 'redirect without location', isSuccess: false }
	}
	try {
		const nextUrl = new URL(location, currentUrl)
		if (!isAllowedMediaUrl(nextUrl)) {
			return {
				error: `blocked redirect host ${nextUrl.hostname}`,
				isSuccess: false,
			}
		}
		return nextUrl
	} catch {
		return { error: 'invalid redirect URL', isSuccess: false }
	}
}

async function readImageResponse(
	response: Response,
): Promise<MediaBytesResult> {
	if (!response.ok) {
		return { error: `HTTP ${response.status}`, isSuccess: false }
	}
	const [mimeType = ''] = (response.headers.get('content-type') ?? '')
		.split(';', 1)
		.map(part => part.trim().toLowerCase())
	if (!SUPPORTED_IMAGE_TYPES.has(mimeType)) {
		return {
			error: `unsupported type ${mimeType || 'unknown'}`,
			isSuccess: false,
		}
	}
	const bytes = await readBoundedBytes(response, MAX_IMAGE_BYTES)
	if (!bytes) return { error: 'response too large', isSuccess: false }
	return { bytes, isSuccess: true, mimeType }
}
