// Package-wide low-level JSON value coercion for the footer extension
// (tool args, session payloads, quota APIs).
//
// The nextnode/no-generic-runtime-guard rule wants unknown values validated at
// real I/O boundaries; these helpers are exactly that boundary helper, and the
// rule's own docs sanction exactly one canonical package-wide guard through a
// targeted disable comment. Coercions return NaN for absent/invalid fields so
// callers branch on Number.isFinite instead of interrogating undefined.
//
// Numeric sentinel for absent or non-numeric JSON fields.
export const FIELD_NAN = Number.NaN

/**
 * Type guard: JSON object value (never array, never null).
 * Sanctioned generic runtime guard: unknown JSON boundary (see file header).
 */
// oxlint-disable-next-line nextnode/no-generic-runtime-guard
export function isRecord(
	candidate: unknown,
): candidate is Record<string, unknown> {
	return (
		typeof candidate === 'object' &&
		candidate !== null &&
		!Array.isArray(candidate)
	)
}

/** Finite number of a JSON field; NaN when the field is absent/non-numeric. */
export function finiteNumber(raw: unknown): number {
	if (typeof raw === 'number') return raw
	if (typeof raw !== 'string') return Number.NaN
	const parsed = Number(raw)
	return Number.isFinite(parsed) ? parsed : Number.NaN
}

/** Finite value with an explicit fallback when absent/invalid. */
export function finiteOr(raw: unknown, fallback: number): number {
	const parsed = finiteNumber(raw)
	return Number.isFinite(parsed) ? parsed : fallback
}

/** Unwrap `{ val: n }` wrappers or plain numbers from a JSON value. */
export function valOf(raw: unknown): number {
	if (typeof raw === 'number') return raw
	if (isRecord(raw) && 'val' in raw) return finiteNumber(raw.val)
	return finiteNumber(raw)
}
