/**
 * settle-handshake - the cross-extension claim on `agent_settled`.
 *
 * A message queued by one settle handler starts asynchronously, so another
 * handler in the same dispatch still sees `ctx.isIdle()`. The extension whose
 * operation must run first therefore claims this boundary; goal-gate defers
 * without spending its continuation budget. Context-budget owns the claim
 * while threshold or recovery compaction is pending.
 *
 * The deadline is refreshed while work continues and expires if a failed
 * extension forgets to release it. This module has no IO or Pi dependency.
 */

const TTL_MINUTES = 15
const MS_PER_MINUTE = 60_000
export const CLAIM_TTL_MS = TTL_MINUTES * MS_PER_MINUTE

let claimDeadline = 0

/** Claim the settle boundary for a live operation, or refresh its deadline. */
export function beginSettleClaim(now: number = Date.now()): void {
	claimDeadline = now + CLAIM_TTL_MS
}

/** Release the settle boundary after completion, failure, or cancellation. */
export function endSettleClaim(): void {
	claimDeadline = 0
}

/** Whether another extension currently owns the settle boundary. */
export function isSettleClaimActive(now: number = Date.now()): boolean {
	return claimDeadline > now
}
