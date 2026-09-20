/**
 * context-budget - how this conversation gets replaced, and what pi's own
 * compaction is allowed to do while a handoff cycle is live.
 *
 * Compaction is the reset this extension wants: the same session survives, so
 * nothing has to be carried over, and the summary must be the handoff the agent
 * wrote - never pi's own summary of the context being dropped, which is the
 * lossy pass this whole extension exists to avoid. The three session events
 * below are the only places pi asks for a summary or reports one, so this is
 * the one module that decides what replaces the conversation. The kept tail is
 * chosen in `boundary.ts`, by real weight.
 */

import { endHandoffCycle } from '../settle-handshake/handshake.ts'

import { pickKeptBoundary } from './boundary.ts'
import { shortTokens } from './budget.ts'
import { STATUS_KEY } from './command.ts'
import { isUsableHandoff } from './handoff.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { ContextGuard } from './guard.ts'
import type { HandoffSummary, SummaryClaim } from './summary.ts'

/**
 * A provider refusal is the only measurement of a model's real limit this
 * extension ever gets: a declared window can be far larger than what the API
 * accepts. `models.json` gives `deepseek-v4-flash` 1,000,000 tokens, and its
 * API refused a 180,824-token request - the very request that carried the
 * handoff ask (2026-09-19, session 01a0b968). pi answers that refusal by
 * aborting the turn - the bare "Operation aborted" a human then stares at -
 * and compacting. Learning the limit holds the next ceiling under it; naming
 * the cause is what turns an unexplained abort into a diagnosis.
 */
function reportOverflow(
	guard: ContextGuard,
	ctx: ExtensionContext,
	tokensBefore: number,
): void {
	guard.noteOverflow(tokensBefore)
	ctx.ui.notify(
		`Provider refused the request at ${shortTokens(tokensBefore)} tokens (context overflow) - pi compacts this turn, and the ceiling is held under that limit from now on.`,
		'warning',
	)
}

/**
 * The handoff this compaction must be summarised by, or `idle` when the
 * compaction is not ours to steer.
 *
 * A pi-initiated compaction can land between the mid-turn escalation and the
 * settle: the handoff is written but never armed. It is this conversation's
 * memory - use it, exactly as the settle path would have, instead of pi's
 * generic summary. Only while the cycle has not already steered a compaction:
 * after a claim or a failure the stand-down is deliberate.
 */
function claimForCompaction(
	guard: ContextGuard,
	summary: HandoffSummary,
): SummaryClaim {
	const claim = summary.claim()
	if (claim.type !== 'idle' || summary.cycleConsumed) return claim
	const inFlight = guard.handoffFile
	if (!inFlight || !isUsableHandoff(inFlight)) return claim
	summary.arm(inFlight)
	return summary.claim()
}

export function watchCompaction(
	pi: ExtensionAPI,
	guard: ContextGuard,
	summary: HandoffSummary,
): void {
	pi.on('session_before_compact', (event, ctx) => {
		if (event.reason === 'overflow') {
			reportOverflow(guard, ctx, event.preparation.tokensBefore)
		}
		const claim = claimForCompaction(guard, summary)
		if (claim.type === 'idle') return
		if (claim.type === 'missing') {
			// The handoff vanished between the settle check and here. pi's
			// generic summary is not a substitute for it, so the compaction is
			// refused rather than performed with the wrong text - and the cycle
			// that armed it is over.
			endHandoffCycle()
			ctx.ui.notify(
				`Handoff is missing or empty: ${claim.path} - compaction cancelled, this session keeps its context.`,
				'error',
			)
			return { cancel: true }
		}
		const { preparation } = event
		return {
			compaction: {
				summary: claim.text,
				// The kept tail is chosen here, by the handoff's coverage: the
				// handoff is the memory of everything written before it, so the
				// kept tail is exactly the work it does not cover - the newest
				// cut point at or before its write time. pi's own boundary comes
				// from an estimate that truncates tool results, so a tail full of
				// large tool outputs passes its walk while weighing several times
				// the budget (measured 2026-09-19: 21 of 191 compactions left the
				// next prompt above 100k). pi's boundary stays as the fallback for
				// the no-floor case.
				firstKeptEntryId: pickKeptBoundary({
					entries: event.branchEntries,
					fallbackId: preparation.firstKeptEntryId,
					handoffWrittenAt: claim.modifiedAt,
				}),
				tokensBefore: preparation.tokensBefore,
			},
		}
	})
	// Whatever compacted - this extension or pi's own threshold - the prompt
	// shrank, so the ceiling can be crossed again: restart the guard's cycle,
	// and drop the claim, which no restarted cycle can inherit.
	pi.on('session_compact', (_event, ctx) => {
		guard.enable(guard.currentCeiling())
		endHandoffCycle()
		ctx.ui.setStatus(STATUS_KEY, undefined)
	})
	// Only speaks when the handoff itself was the summary in flight.
	pi.on('session_compact_failed', (event, ctx) => {
		if (!event.fromExtension) return
		ctx.ui.notify(
			`Compaction from the handoff failed: ${event.errorMessage ?? 'aborted'} - this session keeps its context.`,
			'error',
		)
	})
}
