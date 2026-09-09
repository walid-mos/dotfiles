/** Jina Reader page renders: one bounded, timed request, optional API key. */

import process from 'node:process'

import { readBoundedText } from '../http/bounded-response.ts'

import { rewriteSocialPageUrl } from './social-url.ts'

const REQUEST_TIMEOUT_MS = 25_000
const MAX_READER_RESPONSE_BYTES = 524_288

/** The Reader markdown for one social page URL, undefined on any failure. */
export async function fetchReaderMarkdown(
	rawUrl: string,
	fetcher: typeof fetch = fetch,
): Promise<string | undefined> {
	const readerUrl = rewriteSocialPageUrl(rawUrl)
	if (!readerUrl) return undefined
	const authorization = process.env.JINA_API_KEY?.trim()
	try {
		const response = await fetcher(readerUrl, {
			headers: {
				Accept: 'text/plain',
				'User-Agent': 'pi-social-fetch/1.0',
				...(authorization && {
					Authorization: `Bearer ${authorization}`,
				}),
			},
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		})
		if (!response.ok) return undefined
		return await readBoundedText(response, MAX_READER_RESPONSE_BYTES)
	} catch {
		return undefined
	}
}
