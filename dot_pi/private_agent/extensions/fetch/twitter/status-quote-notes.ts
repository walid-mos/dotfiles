/** Quoted-post texts formatted for the fetch_content hydration note. */

import { fxtwitterRecord, fxtwitterString } from './fx-payload.ts'
import { quoteChainStatuses, quoteDepthPrefix } from './quote-chain.ts'

/** Short quoted-post texts formatted for the fetch_content media note. */
export function statusQuoteTextNotes(
	payload: unknown,
	maxQuoteCharacters: number,
): string[] {
	const rootStatus = fxtwitterRecord(fxtwitterRecord(payload)?.status)
	if (!rootStatus) return []
	const notes: string[] = []
	for (const entry of quoteChainStatuses(rootStatus)) {
		if (entry.depth === 0) continue
		const text = fxtwitterString(entry.status, 'text')
		if (!text) continue
		const author = fxtwitterString(
			fxtwitterRecord(entry.status.author),
			'screen_name',
		)
		notes.push(
			`${quoteDepthPrefix(entry.depth)}${author ? `@${author}: ` : ''}${text.slice(0, maxQuoteCharacters)}`,
		)
	}
	return notes
}
