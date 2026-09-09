/** Teach fetch_content about social pages: URL rewriting to the Reader. */

import { rewriteSocialPageUrl } from './social-url.ts'

export type SocialFetchContentPatch = {
	readonly clearAuth: boolean
	readonly url: string | undefined
	readonly urls: string[] | undefined
}

type FetchRecord = Record<string, unknown>

function isFetchRecord(candidate: unknown): candidate is FetchRecord {
	return (
		typeof candidate === 'object' &&
		candidate !== null &&
		!Array.isArray(candidate)
	)
}

function fetchRecord(candidate: unknown): FetchRecord | undefined {
	if (!isFetchRecord(candidate)) return undefined
	return candidate
}

function stringEntries(candidate: unknown): string[] {
	const entries: string[] = []
	for (const entry of Array.isArray(candidate) ? candidate : []) {
		if (typeof entry === 'string') entries.push(entry)
	}
	return entries
}

/**
 * Patch for a fetch_content input targeting a social page: rewrite the page
 * URL(s) to Jina Reader endpoints. `url`/`urls` become ONLY strings.
 */
export function socialFetchContentPatch(
	input: unknown,
): SocialFetchContentPatch {
	const fetchInput = fetchRecord(input)
	if (!fetchInput)
		return { clearAuth: false, url: undefined, urls: undefined }
	const rewrittenUrl =
		typeof fetchInput.url === 'string'
			? rewriteSocialPageUrl(fetchInput.url)
			: undefined
	const originalUrls = stringEntries(fetchInput.urls)
	const rewrittenUrls = originalUrls.map(
		entry => rewriteSocialPageUrl(entry) ?? entry,
	)
	const listRewritten = originalUrls.some(
		(entry, index) => entry !== rewrittenUrls[index],
	)
	return {
		url: rewrittenUrl,
		urls: listRewritten && rewrittenUrls.length ? rewrittenUrls : undefined,
		clearAuth: Boolean(rewrittenUrl) || listRewritten,
	}
}
