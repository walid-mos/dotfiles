/**
 * settle-handshake - the one cross-extension contract on the settle boundary.
 *
 * Several extensions act when `agent_settled` fires, and each checks
 * `ctx.isIdle()` before acting - but `isIdle()` does not see a message another
 * extension queued moments earlier in the same event dispatch: the run a
 * `sendUserMessage` triggers starts asynchronously, so every handler in that
 * dispatch still sees an idle agent and acts too. Observed 2026-09-19,
 * session 01a0b0d4: a context-budget handoff request and a goal-gate
 * continuation queued from the same settle interleaved into runs that drowned
 * the handoff directive, burned its bounded retries, and ended in stacked
 * directed compactions and an error storm.
 *
 * The handshake replaces that race with an explicit claim. The extension whose
 * operation must win owns the boundary for as long as its cycle is live, and
 * the others defer a turn - their work is not lost, it resumes at the next
 * settle. Today: `context-budget` claims the boundary for a handoff cycle (the
 * handoff replaces the conversation and already carries the goal state, so a
 * continuation queued under it races the compaction), and `goal-gate` defers
 * continuations while the claim is live.
 *
 * The claim self-heals: it carries a TTL refreshed by every begin, so a cycle
 * wedged by a bug elsewhere cannot latch the boundary forever - it expires and
 * the deferred extensions resume, which degrades to the pre-handshake race
 * instead of silently parking a goal forever.
 *
 * No IO, no pi imports: a module-level singleton, because every extension
 * loads into pi's one process and imports this exact file.
 */

/**
 * How long a claim stays live without a refresh. A handoff cycle is a few
 * settles and one compaction - minutes; this covers it with margin, and
 * every request, re-ask and compaction attempt refreshes the deadline.
 */
const TTL_MINUTES = 15
const MS_PER_MINUTE = 60_000
export const CLAIM_TTL_MS = TTL_MINUTES * MS_PER_MINUTE

/** When the live claim expires, in `Date.now()` milliseconds; 0 = no claim. */
let claimDeadline = 0

/**
 * Claim the boundary for a live cycle, or refresh an existing claim. Called
 * when a handoff request goes out, at every re-ask, and at every compaction
 * attempt - the moments the cycle is demonstrably still in progress.
 */
export function beginHandoffCycle(now: number = Date.now()): void {
	claimDeadline = now + CLAIM_TTL_MS
}

/** Release the boundary: the cycle reached an end (done, failed, given up). */
export function endHandoffCycle(): void {
	claimDeadline = 0
}

/** Whether another extension currently owns the settle boundary. */
export function isHandoffCycleActive(now: number = Date.now()): boolean {
	return claimDeadline > now
}
