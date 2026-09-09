/** Teach fetch_content about X/Twitter: URL rewriting and FxTwitter detection. */

import { fxtwitterRecord } from './fx-payload.ts'
import { isFxTwitterApiUrl, rewriteTwitterStatusUrl } from './status-url.ts'

export type FetchContentPatch = {
	readonly clearAuth: boolean
	readonly url: string | undefined
	readonly urls: string[] | undefined
}

function stringEntries(candidate: unknown): string[] {
	return Array.isArray(candidate)
		? candidate.filter(
				(entry): entry is string => typeof entry === 'string',
			)
		: []
}

/** All URLs the fetch_content call may target (input + result details). */
export function fetchContentUrls(input: unknown, details: unknown): string[] {
	const fetchInput = fxtwitterRecord(input)
	const fetchDetails = fxtwitterRecord(details)
	const url = typeof fetchInput?.url === 'string' ? [fetchInput.url] : []
	return [
		...url,
		...stringEntries(fetchInput?.urls),
		...stringEntries(fetchDetails?.urls),
	]
}

export function containsFxTwitterApiUrl(
	input: unknown,
	details: unknown,
): boolean {
	return fetchContentUrls(input, details).some(isFxTwitterApiUrl)
}

/**
 * Patch for a fetch_content input targeting a status: rewrite the status
 * URL(s) to FxTwitter API endpoints. `url`/`urls` become ONLY strings.
 */
export function fetchContentPatch(input: unknown): FetchContentPatch {
	const fetchInput = fxtwitterRecord(input)
	if (!fetchInput)
		return { clearAuth: false, url: undefined, urls: undefined }
	const rewrittenUrl =
		typeof fetchInput.url === 'string'
			? rewriteTwitterStatusUrl(fetchInput.url)
			: undefined
	const originalUrls = Array.isArray(fetchInput.urls)
		? fetchInput.urls
		: undefined
	const rewrittenUrls = originalUrls?.map(
		entry => rewriteTwitterStatusUrl(entry) ?? entry,
	)
	const listRewritten = Boolean(
		originalUrls?.some((entry, index) => entry !== rewrittenUrls?.[index]),
	)
	return {
		url: rewrittenUrl,
		urls: listRewritten && rewrittenUrls ? rewrittenUrls : undefined,
		clearAuth: Boolean(rewrittenUrl) || listRewritten,
	}
}
