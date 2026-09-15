/**
 * Collapse HTML error pages embedded in provider error messages.
 *
 * Model providers sit behind reverse proxies (nginx, Caddy, Cloudflare).
 * When the proxy cannot reach its upstream, it answers 502/504 with its own
 * static HTML error page instead of the JSON API error the client expects,
 * and pi-ai embeds that body verbatim in the assistant error message. This
 * module replaces the embedded page with its `<title>` (or `<h1>`), keeps a
 * meaningful non-HTML prefix (typically the HTTP status), and appends a
 * fixed hint that the failure is server-side.
 */

/** Earliest marker of an embedded HTML document or fragment. */
const HTML_PAGE_START =
	/<!doctype[\s>]|<(?:html|head|body|title|center|h1)[\s>]/i

const HINT =
	'(gateway error page from the model provider - server-side outage, not caused by the request; retry or switch model)'

const FALLBACK = 'unreadable error page'

/** Common entities a gateway error page may contain in its title. */
const ENTITIES: Record<string, string> = {
	'&quot;': '"',
	'&#39;': "'",
	'&apos;': "'",
	'&lt;': '<',
	'&gt;': '>',
	'&amp;': '&',
}

function decodeEntities(text: string): string {
	return text.replace(
		/&(?:quot|#39|apos|lt|gt|amp);/g,
		entity => ENTITIES[entity] ?? entity,
	)
}

function stripInnerTags(html: string): string {
	return html.replace(/<[^>]*>/g, '')
}

/** Content of the first `<tag>...</tag>`, inner tags stripped, trimmed. */
function firstTagContent(html: string, tag: string): string | undefined {
	const match = new RegExp(`<${tag}\\b[^>]*>([\\S\\s]*?)</${tag}>`, 'i').exec(
		html,
	)
	if (match === null) {
		return undefined
	}
	const content = decodeEntities(stripInnerTags(match[1] ?? '')).trim()
	if (!content.length) {
		return undefined
	}
	return content
}

export interface SanitizedProviderError {
	/** Message with any embedded HTML page collapsed to a single readable line. */
	text: string
	/** True when an HTML error page was found and replaced. */
	hadHtmlPage: boolean
}

export function sanitizeProviderError(message: string): SanitizedProviderError {
	if (!message.length) {
		return { text: message, hadHtmlPage: false }
	}
	const boundary = HTML_PAGE_START.exec(message)
	if (boundary === null) {
		return { text: message, hadHtmlPage: false }
	}

	const html = message.slice(boundary.index)
	const prefix = message
		.slice(0, boundary.index)
		// Drop the ": " most error formatters append before the body.
		.replace(/[\s:]+$/, '')
		.trim()
	const extracted =
		firstTagContent(html, 'title') ?? firstTagContent(html, 'h1')
	const core =
		extracted ?? (prefix.length ? `${prefix} ${FALLBACK}` : FALLBACK)
	const deduped =
		extracted &&
		prefix.length &&
		!core.toLowerCase().includes(prefix.toLowerCase())
			? `${prefix} ${core}`
			: core
	return { text: `${deduped} ${HINT}`, hadHtmlPage: true }
}
