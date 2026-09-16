// Fallback chain mechanics: model reference formatting, cooldown bookkeeping for
// models that just failed, and candidate ordering. Pure - the caller owns the
// clock and the map. Unit-tested in `../tests/model-fallback.test.ts`.

/** Model reference (`provider/modelId`) -> epoch ms until which it is excluded. */
export type Exclusions = Map<string, number>

export function modelReference(model: {
	provider: string
	id: string
}): string {
	return `${model.provider}/${model.id}`
}

/** Splits at the first slash: the model id itself may contain slashes. */
export function parseModelReference(
	reference: string,
): { provider: string; modelId: string } | undefined {
	const separator = reference.indexOf('/')
	if (separator <= 0 || separator === reference.length - 1) return undefined
	return {
		provider: reference.slice(0, separator),
		modelId: reference.slice(separator + 1),
	}
}

/** A model that just failed stays out of the chain for `ttlMs`, so a flapping
 * provider cannot be re-entered (or restored to) on the next turn. */
export function recordExclusion(
	exclusions: Exclusions,
	model: string | undefined,
	now: number,
	ttlMs: number,
): void {
	if (!model) return
	exclusions.set(model, now + ttlMs)
}

export function activeExclusions(
	exclusions: ReadonlyMap<string, number>,
	now: number,
): Set<string> {
	const active = new Set<string>()
	for (const [model, until] of exclusions) {
		if (until > now) active.add(model)
	}
	return active
}

/**
 * Chain order after a failure: everything after the failed model, then a wrap
 * back to the top, so a chain whose tail is exhausted restarts from the first
 * usable model once earlier cooldowns expire. The failed model itself is never
 * a candidate.
 */
export function fallbackCandidates(
	failedModel: string | undefined,
	chain: readonly string[],
	excluded: ReadonlySet<string>,
): string[] {
	const start = failedModel ? chain.indexOf(failedModel) + 1 : 0
	const rotated = [...chain.slice(start), ...chain.slice(0, start)]
	return rotated.filter(
		candidate => candidate !== failedModel && !excluded.has(candidate),
	)
}
