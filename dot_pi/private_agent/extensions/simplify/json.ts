/** Reading unknown values: the guards every /simplify module uses before trusting a payload. */

/**
 * The one generic guard this extension needs: `tool_execution_end` delivers an
 * untyped tool result, and the subagent payload is read field by field from it.
 * Every other payload crossing a boundary is validated with the typebox schema
 * in `lenses.ts`.
 */
// oxlint-disable-next-line nextnode/no-generic-runtime-guard -- canonical low-level guard for pi's untyped tool result; schema validation lives in lenses.ts/findings.ts.
export function isRecord(
	candidate: unknown,
): candidate is Record<string, unknown> {
	return (
		typeof candidate === 'object' &&
		candidate !== null &&
		!Array.isArray(candidate)
	)
}

/** Human text of a thrown value; never rethrows and never inspects internals. */
export function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message
	if (typeof error === 'string') return error
	return 'unknown error'
}
