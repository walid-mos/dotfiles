export type JsonRecord = Record<string, unknown>

export function toRecord(candidate: unknown): JsonRecord | undefined {
	if (
		typeof candidate !== 'object' ||
		candidate === null ||
		Array.isArray(candidate)
	) {
		return undefined
	}
	return Object.fromEntries(Object.entries(candidate))
}

export function parseJsonRecord(text: string): JsonRecord | undefined {
	try {
		return toRecord(JSON.parse(text))
	} catch {
		return undefined
	}
}

export function readString(
	record: JsonRecord,
	key: string,
): string | undefined {
	const field = record[key]
	if (typeof field !== 'string') return undefined
	return field
}

export function readNumber(
	record: JsonRecord,
	key: string,
): number | undefined {
	const field = record[key]
	if (typeof field !== 'number') return undefined
	return field
}

export function readBoolean(
	record: JsonRecord,
	key: string,
): boolean | undefined {
	const field = record[key]
	if (typeof field !== 'boolean') return undefined
	return field
}

export function readRecord(
	record: JsonRecord,
	key: string,
): JsonRecord | undefined {
	return toRecord(record[key])
}

export function readStringList(
	record: JsonRecord,
	key: string,
): string[] | undefined {
	const field = record[key]
	if (!Array.isArray(field)) return undefined
	const strings = field.flatMap(entry =>
		typeof entry === 'string' ? [entry] : [],
	)
	if (strings.length !== field.length) return undefined
	return strings
}

export function readRecordList(
	record: JsonRecord,
	key: string,
): JsonRecord[] | undefined {
	const field = record[key]
	if (!Array.isArray(field)) return undefined
	const records = field.flatMap(entry => {
		const entryRecord = toRecord(entry)
		return entryRecord ? [entryRecord] : []
	})
	if (records.length !== field.length) return undefined
	return records
}

function hasEveryKey<Key extends string>(
	partial: Partial<Record<Key, string>>,
	keys: readonly Key[],
): partial is Record<Key, string> {
	return keys.every(key => Boolean(partial[key]))
}

export function readStrings<Key extends string>(
	record: JsonRecord,
	keys: readonly Key[],
): Record<Key, string> | undefined {
	const found: Partial<Record<Key, string>> = {}
	for (const key of keys) {
		const fieldText = readString(record, key)
		if (!fieldText) return undefined
		found[key] = fieldText
	}
	if (!hasEveryKey(found, keys)) return undefined
	return found
}
