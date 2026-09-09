/** FxTwitter JSON: document parsing and minimal field readers. */

export type FxTwitterRecord = Record<string, unknown>

export function isFxtwitterRecord(
	candidate: unknown,
): candidate is FxTwitterRecord {
	return (
		typeof candidate === 'object' &&
		candidate !== null &&
		!Array.isArray(candidate)
	)
}

export function fxtwitterRecord(
	candidate: unknown,
): FxTwitterRecord | undefined {
	if (!isFxtwitterRecord(candidate)) return undefined
	return candidate
}

/** First non-empty string field of a record. */
export function fxtwitterString(
	record: FxTwitterRecord | undefined,
	field: string,
): string | undefined {
	const fieldValue = record?.[field]
	if (typeof fieldValue !== 'string' || !fieldValue) return undefined
	return fieldValue
}

/** First finite number field of a record (null and strings count as absent). */
export function fxtwitterNumber(
	record: FxTwitterRecord | undefined,
	field: string,
): number | undefined {
	const fieldValue = record?.[field]
	if (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue)) {
		return undefined
	}
	return fieldValue
}

/** Array field of a record; undefined when missing or not an array. */
export function fxtwitterArray(
	record: FxTwitterRecord | undefined,
	field: string,
): readonly unknown[] | undefined {
	const fieldValue = record?.[field]
	if (!Array.isArray(fieldValue)) return undefined
	return fieldValue
}

/**
 * Parse the status payload out of a fetched document.
 *
 * fetch_content returns markdown documents; the FxTwitter API JSON lives
 * after any document header, before the document separator.
 */
export function parseFxtwitterPayload(document: string): unknown {
	const [payloadDocument = ''] = document.split(/\n\n---\n/, 1)
	const jsonStart = payloadDocument.indexOf('{')
	if (jsonStart < 0) return undefined
	try {
		return JSON.parse(payloadDocument.slice(jsonStart))
	} catch {
		return undefined
	}
}
