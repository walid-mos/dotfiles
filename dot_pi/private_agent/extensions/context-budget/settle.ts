/**
 * context-budget - the settle boundary: where a settled run meets its handoff.
 *
 * `agent_settled` is the first moment pi will not continue on its own, so it
 * is where the whole cycle lives: ask for the handoff when the ceiling was
 * crossed too late for a mid-turn steer, re-ask while the file is missing,
 * compact from it once it exists, and report when the retries are spent. The
 * machinery is a class so the collaborators (pi, the guard, the summary
 * claim, the goal stand-down) are captured once and every method keeps to
 * the parameter cap.
 *
 * The goal-completed stand-down (`goal.ts`) runs before every decision here:
 * a finished checklist releases the claim and idles the session instead of
 * paying for any of it, and the continuation after a compaction is skipped
 * when the handoff-writing turn itself closed the checklist.
 */

import { mkdirSync } from 'node:fs'

import { getAgentDir } from '@earendil-works/pi-coding-agent'

import {
	beginHandoffCycle,
	endHandoffCycle,
} from '../settle-handshake/handshake.ts'

import {
	MAX_SETTLE_RETRIES,
	continuationText,
	fallbackCompactionText,
} from './budget.ts'
import { STATUS_KEY } from './command.ts'
import { completedGoal } from './goal.ts'
import { handoffMessage } from './guard.ts'
import { handoffDir } from './handoff.ts'
import { handoffClosedOnDisk } from './summary.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { GoalCompletion } from './goal.ts'
import type { ContextGuard, SettleAction } from './guard.ts'
import type { HandoffSummary } from './summary.ts'

/**
 * Send the handoff request: the directive to the path the guard chose, plus
 * one notice. Used where the ceiling is crossed and for the settle re-asks.
 */
export function requestHandoff(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	request: { path: string; ceiling: number },
): void {
	// The request owns the settle boundary from this moment: a goal-gate
	// continuation queued under it would race the handoff run.
	beginHandoffCycle()
	mkdirSync(handoffDir(getAgentDir()), { recursive: true })
	pi.sendUserMessage(handoffMessage(request), { deliverAs: 'steer' })
	ctx.ui.notify(
		`Handoff requested at ${request.path} - this session compacts from it once it is written.`,
		'warning',
	)
}

export class HandoffSettler {
	private noticedCompletionAt: number | undefined

	constructor(
		private readonly pi: ExtensionAPI,
		private readonly guard: ContextGuard,
		private readonly summary: HandoffSummary,
	) {}

	/** Register the `agent_settled` handler: the cycle's whole engine side. */
	register(): void {
		this.pi.on('agent_settled', (_event, ctx) => {
			// Same gate as the guard: a delegated run has no one to continue.
			if (ctx.mode !== 'tui') return
			// One `agent_settled` dispatch leaves every handler seeing an idle
			// agent - a message another extension queued starts its run
			// asynchronously - so `isIdle()` alone arbitrates nothing. The
			// handshake does: while this extension holds a live claim no other
			// extension queues under it (goal-gate defers), and a run another
			// extension started is one this extension must not steer into.
			if (!ctx.isIdle()) return
			// Goal evaluation comes first at this boundary, before the guard
			// acts: a completed checklist means no handoff request, no re-ask,
			// no compaction, no continuation - nothing is paid for finished
			// work. goal-gate runs the same ledger check in its own handler;
			// both read the file, so the handler order cannot matter.
			const completion = completedGoal(
				getAgentDir(),
				ctx.sessionManager.getSessionId(),
			)
			if (completion) {
				this.standDown(ctx, completion)
				return
			}
			this.perform(ctx, this.guard.settled())
		})
	}

	/**
	 * The budget pipeline ends for a completed goal: the boundary claim is
	 * released (goal-gate evaluates the same ledger first, and nothing of
	 * ours may queue under a finished checklist) and the status is dropped.
	 * The notice goes out once per completion - every settled run of a done
	 * checklist would otherwise repeat it. The stand-down holds until the
	 * ledger changes: a new `goal` declaration re-arms the budget, a bare
	 * prompt does not.
	 */
	private standDown(ctx: ExtensionContext, completion: GoalCompletion): void {
		endHandoffCycle()
		ctx.ui.setStatus(STATUS_KEY, undefined)
		if (this.noticedCompletionAt === completion.completedAt) return
		this.noticedCompletionAt = completion.completedAt
		ctx.ui.notify(
			`Goal complete (${completion.path}) - no handoff, no compaction, no continuation; the session stays idle. Declare a new goal to work past the ceiling again: the handoff arms then if it is still crossed.`,
			'info',
		)
	}

	/** One guard settle decision, performed: ask, re-ask, compact, or report. */
	private perform(ctx: ExtensionContext, action: SettleAction): void {
		if (action.type === 'idle') return
		if (action.type === 'handoff') {
			// The run reached the ceiling and pi will not continue on its own:
			// the boundary is here, so ask now instead of interrupting a turn.
			requestHandoff(this.pi, ctx, action)
			return
		}
		if (action.type === 'givenUp') {
			this.compactDirected(ctx, action.path)
			return
		}
		if (action.type === 'reask') {
			// The cycle is still live: keep the boundary claimed (and the
			// claim's TTL fresh) while the re-ask runs.
			beginHandoffCycle()
			this.pi.sendUserMessage(handoffMessage(action), {
				deliverAs: 'steer',
			})
			ctx.ui.notify(
				`Handoff still missing - asking again (${action.retry}/${MAX_SETTLE_RETRIES}).`,
				'warning',
			)
			return
		}
		ctx.ui.notify(
			`Handoff ready - replacing this conversation with it (${action.path}).`,
			'info',
		)
		// The compaction replaces the conversation underneath any runs queued
		// from this moment, so the claim stays live until it completes.
		beginHandoffCycle()
		this.summary.arm(action.path)
		this.compactFromHandoff(ctx)
	}

	/**
	 * Replace the conversation with the handoff. pi compacts this session in
	 * place - the transcript, the model and the thinking level are untouched -
	 * and `watchCompaction` hands the handoff in as the summary of that
	 * compaction. The caller armed the handoff just before calling: its path
	 * is what the compaction will claim.
	 */
	private compactFromHandoff(ctx: ExtensionContext): void {
		const path = this.summary.armedPath
		ctx.compact({
			onComplete: () => {
				// The prompt was dropped, so the ceiling can be crossed again
				// from a much smaller context: restart the cycle before the
				// continuation runs, otherwise its settle would find this
				// cycle's handoff.
				this.guard.enable(this.guard.currentCeiling())
				// The cycle is over: the boundary returns to ordinary
				// arbitration, and goal-gate resumes continuing its checklist.
				endHandoffCycle()
				this.summary.reset()
				// The continuation below can race the compaction being applied:
				// its request may still be built from the pre-compaction
				// context, so the next reading can come back numeric and
				// stale. Skip it (see ContextGuard.noteCompacted) instead of
				// re-crossing the ceiling.
				this.guard.noteCompacted()
				ctx.ui.setStatus(STATUS_KEY, undefined)
				ctx.ui.notify(
					'Conversation replaced by the handoff - continuing.',
					'info',
				)
				setTimeout(() => this.sendContinuation(ctx, path), 0)
			},
			onError: error => {
				// The claim never happened, or pi gave up before it: either way
				// the arming must not survive into an unrelated compaction.
				this.summary.disarm()
				// The boundary is released with the failed cycle; a re-ask or a
				// later compaction attempt claims it afresh.
				endHandoffCycle()
				this.guard.noteCompactFailed()
				ctx.ui.notify(
					`Compaction from the handoff failed (${error.message}) - staying in this session.`,
					'error',
				)
			},
		})
	}

	/**
	 * The deferred tail of a successful compaction. A compaction on its own
	 * leaves the agent idle - the one thing this extension must never
	 * produce - so the continuation goes out here, deferred so no run starts
	 * inside pi's own compaction callback.
	 */
	private sendContinuation(
		ctx: ExtensionContext,
		path: string | undefined,
	): void {
		// A handoff whose next step is closed has nothing for the agent to
		// do on its own: the session idles, which is what a finished pane
		// should do. goal-gate resumes anything this wrongly closed at the
		// next settle or human prompt.
		if (path && handoffClosedOnDisk(path)) {
			ctx.ui.notify(
				'Handoff next step is closed - no continuation sent; prompt this session to resume it.',
				'info',
			)
			return
		}
		// The turn that wrote the handoff may have closed the checklist: a
		// completed goal must not buy the continuation turn. The stand-down
		// holds until the ledger changes (see `goal.ts`).
		const completion = completedGoal(
			getAgentDir(),
			ctx.sessionManager.getSessionId(),
		)
		if (completion) {
			ctx.ui.notify(
				'Goal complete - no continuation sent; prompt this session to resume it.',
				'info',
			)
			return
		}
		// `followUp` never throws while another run is live (a plain send
		// does), and when idle it triggers the turn exactly as before.
		this.pi.sendUserMessage(continuationText(), { deliverAs: 'followUp' })
	}

	/**
	 * The fail-open tail of a cycle whose handoff never appeared: rather than
	 * let the session run to the model window and pi's generic summary, compact
	 * now with instructions pointed at what a resumption needs. The guard
	 * latches the give-up, so this fires once; the boundary is released either
	 * way, and goal-gate's ledger gating resumes.
	 */
	private compactDirected(ctx: ExtensionContext, path: string): void {
		endHandoffCycle()
		ctx.ui.notify(
			`No handoff at ${path} after ${MAX_SETTLE_RETRIES} retries - compacting this session with a directed summary instead.`,
			'error',
		)
		ctx.compact({
			customInstructions: fallbackCompactionText(),
			onError: error => {
				// The session_before_compact hook is not involved on this
				// path, so a failure would otherwise be silent.
				ctx.ui.notify(
					`Directed compaction failed (${error.message}) - staying in this session; lower the ceiling with /context-budget.`,
					'error',
				)
			},
		})
	}
}
