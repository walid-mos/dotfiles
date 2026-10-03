/** Primitive validation at the persisted timing-record boundary. */
// oxlint-disable-next-line nextnode/no-generic-runtime-guard - session entry JSON boundary
export function isMeasuredMs(candidate: unknown): candidate is number {
	return (
		typeof candidate === 'number' &&
		candidate >= 0 &&
		Number.isFinite(candidate)
	)
}

// oxlint-disable-next-line nextnode/no-generic-runtime-guard - session entry JSON boundary
export function isTokenCount(candidate: unknown): candidate is number {
	return (
		typeof candidate === 'number' &&
		Number.isInteger(candidate) &&
		candidate >= 0
	)
}

export function optionalMeasuredMs(candidate: unknown): number | undefined {
	if (!isMeasuredMs(candidate)) return undefined
	return candidate
}
