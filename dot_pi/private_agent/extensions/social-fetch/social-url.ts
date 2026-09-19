/** Instagram/TikTok/Threads page URLs: detect, extract and rewrite to r.jina.ai. */

const READER_BASE_URL = 'https://r.jina.ai'

/** Hosts whose pages the Reader renders usefully (posts, profiles, videos). */
const SOCIAL_HOSTS = new Set([
	'instagram.com',
	'instagr.am',
	'tiktok.com',
	'threads.net',
	'threads.com',
])

const HOST_PREFIX_PATTERN = /^(?:www|m|mobile)\./i
/** Share-link shorteners that are standalone hostnames of tiktok.com. */
const TIKTOK_SHORT_HOSTS = new Set(['vm.tiktok.com', 'vt.tiktok.com'])

/** Root and account-management pages render login walls, not content. */
const NON_CONTENT_SEGMENTS = new Set([
	'',
	'about',
	'accounts',
	'api',
	'challenge',
	'developer',
	'direct',
	'directory',
	'emails',
	'explore',
	'graphql',
	'legal',
	'login',
	'oauth',
	'privacy',
	'settings',
	'signup',
	'sso',
	'ssl',
	'stories',
	'support',
	'terms',
])

const SOCIAL_URL_IN_TEXT_PATTERN =
	/(?<![A-Za-z0-9.-])(?:https?:\/\/)?(?:www\.|m\.|mobile\.|vm\.|vt\.)?(?:instagram\.com|instagr\.am|tiktok\.com|threads\.net|threads\.com)(?:\/[^\s<>"']*)?/gi

/** Punctuation that ends a URL when it appears in running text. */
const TRAILING_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?', "'", '"'])

function canonicalSocialHostname(hostname: string): string {
	const lowered = hostname.toLowerCase()
	if (TIKTOK_SHORT_HOSTS.has(lowered)) return 'tiktok.com'
	return lowered.replace(HOST_PREFIX_PATTERN, '')
}

function normalizedUrl(rawUrl: unknown): URL | undefined {
	if (typeof rawUrl !== 'string') return undefined
	try {
		const candidate = rawUrl.match(/^[a-z][a-z0-9+.-]*:\/\//i)
			? rawUrl
			: `https://${rawUrl}`
		const parsedUrl = new URL(candidate)
		if (
			(parsedUrl.protocol !== 'https:' &&
				parsedUrl.protocol !== 'http:') ||
			parsedUrl.username ||
			parsedUrl.password
		) {
			return undefined
		}
		return parsedUrl
	} catch {
		return undefined
	}
}

/** True when the URL targets a rendered social page (Instagram/TikTok/Threads). */
export function isSocialPageUrl(rawUrl: unknown): boolean {
	const parsedUrl = normalizedUrl(rawUrl)
	if (!parsedUrl) return false
	if (!SOCIAL_HOSTS.has(canonicalSocialHostname(parsedUrl.hostname))) {
		return false
	}
	const firstSegment =
		parsedUrl.pathname.split('/').find(segment => segment.length > 0) ?? ''
	return !NON_CONTENT_SEGMENTS.has(firstSegment.toLowerCase())
}

/** Closing bracket to its matching opener. */
const BRACKET_OPENERS = new Map([
	[')', '('],
	[']', '['],
	['}', '{'],
])

function countCharacter(text: string, character: string): number {
	return text.split(character).length - 1
}

/** True when `url` ends with a closing bracket that has no matching opener. */
function endsWithUnbalancedBracket(url: string): boolean {
	const last = url.at(-1)
	if (!last) return false
	const opener = BRACKET_OPENERS.get(last)
	if (!opener) return false
	return countCharacter(url, last) > countCharacter(url, opener)
}

/** Strip trailing punctuation and unbalanced closing brackets from a URL. */
function stripTrailingNoise(url: string): string {
	let strippedUrl = url
	for (;;) {
		const last = strippedUrl.at(-1)
		if (!last) break
		if (
			TRAILING_PUNCTUATION.has(last) ||
			endsWithUnbalancedBracket(strippedUrl)
		) {
			strippedUrl = strippedUrl.slice(0, -1)
			continue
		}
		break
	}
	return strippedUrl
}

/**
 * Social page URLs found in text, normalized to absolute https URLs,
 * deduplicated, capped at `maximumUrls`.
 */
export function socialUrlsInText(text: string, maximumUrls: number): string[] {
	const urls = new Set<string>()
	for (const [candidate] of text.matchAll(SOCIAL_URL_IN_TEXT_PATTERN)) {
		const parsedUrl = normalizedUrl(stripTrailingNoise(candidate))
		if (!parsedUrl || !isSocialPageUrl(parsedUrl.href)) continue
		urls.add(parsedUrl.href)
		if (urls.size >= maximumUrls) break
	}
	return [...urls]
}

/** An original social page URL rewritten to its Jina Reader endpoint. */
export function rewriteSocialPageUrl(rawUrl: unknown): string | undefined {
	if (!isSocialPageUrl(rawUrl)) return undefined
	const parsedUrl = normalizedUrl(rawUrl)
	if (!parsedUrl) return undefined
	return `${READER_BASE_URL}/${parsedUrl.href}`
}
