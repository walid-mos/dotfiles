/**
 * fallback - the bounded transient retry of the failing model.
 *
 * Pi's own agent-level retry is off in this config, so the recovery carries its
 * own small budget: a failing model gets at most `transientRetryLimit` retried
 * attempts between successes, each after a fixed wait, before the chain
 * cascade starts. retry-budget.ts owns the credits without IO.
 * The caller owns the model request and every pi call.
 *
 * A retry reuses pi's own boundary machinery instead of a second request: the
 * failed assistant message is dropped from the model projection with a
 * `context_edit` (`failedAttemptOmission`), and `agent_before_settle` returns
 * `continue: true` so pi issues the next provider request on the same model.
 */

import { setTimeout } from 'node:timers/promises'

import type {
	BoundaryContextPreview,
	ContextEditEntryDraft,
} from '@earendil-works/pi-coding-agent'

/** The bounded wait between a retryable failure and its same-model retry. */
export async function waitForRetryDelay(
	delayMs: number,
	signal: AbortSignal | undefined,
): Promise<boolean> {
	if (signal?.aborted) return false
	try {
		await setTimeout(delayMs, undefined, { signal })
		return true
	} catch (error) {
		if (signal?.aborted) return false
		throw new Error('fallback retry delay failed', { cause: error })
	}
}

/**
 * The `context_edit` that hides a failed assistant attempt from the retried
 * request: the last projected message is that attempt when the boundary
 * follows a provider error. Without it, pi refuses a continuation after an
 * error because the transcript would end on a failed assistant message.
 */
export function failedAttemptOmission(
	context: BoundaryContextPreview,
): ContextEditEntryDraft | undefined {
	for (const entry of [...context.contextEntries].toReversed()) {
		const last = entry.messages[entry.messages.length - 1]
		if (!last) continue
		if (last.role !== 'assistant' || last.stopReason !== 'error')
			return undefined
		return {
			type: 'context_edit',
			targetId: entry.sourceEntry.id,
			replacement: null,
		}
	}
	return undefined
}
