/**
 * context-budget - turn the prompt ceiling into a resumption handoff instead
 * of a lossy compaction.
 *
 * Cost is linear in prompt size: a turn at a 400k prompt bills roughly 4x a
 * turn at 100k, and the prompt never shrinks on its own, so long sessions are
 * where the money goes. Measured over ten days of session logs, 75% of the
 * spend sat on turns whose prompt exceeded 128k, and the top 10 sessions were
 * 78% of it. Pi only auto-compacts near the model window (1.05M here), and it
 * summarizes, which drops detail. The working ceiling is owned here, in
 * `<agentDir>/context-budget.json` - never as a `models.json` `contextWindow`
 * override, which would fight the provider's real window instead.
 *
 * So this extension watches a ceiling the user picks. Crossing it never
 * interrupts a turn: the ceiling is marked, and at the settle boundary - the
 * moment pi will not continue on its own - the extension asks the agent to
 * write a resumption handoff, then stops. Only when the prompt is close
 * enough to the model's real window that pi would compact on its own within
 * a turn does it steer mid-turn instead. Once the file exists, the extension
 * replaces the conversation with it: the session is compacted in place - the
 * transcript, the model and the thinking level all survive - and the summary
 * given to that compaction is the handoff itself, so none of pi's own summary
 * is ever used. The chain then continues on its own, so it never waits for a
 * human; a run that ends without the file is re-asked, bounded, and if the
 * file never appears the session is compacted anyway with directed
 * instructions rather than run to the window.
 *
 * The settle boundary is shared with other extensions (goal-gate continues
 * open checklists there), and one `agent_settled` dispatch leaves every
 * handler seeing an idle agent - a queued message's run starts
 * asynchronously. This extension therefore claims the boundary through
 * `extensions/settle-handshake/` for as long as a handoff cycle is live:
 * request, re-ask and compaction attempt each refresh the claim, and
 * goal-gate defers its continuations until the claim ends. The handoff
 * replaces the conversation and carries the goal state, so it must go first.
 *
 * Modules:
 *   budget.ts    - pure policy: ceilings, levels, clamping, injected texts
 *   guard.ts     - the per-turn state machine (pure, injected probes)
 *   store.ts     - the persisted ceiling (`<agentDir>/context-budget.json`)
 *   summary.ts   - the handoff a compaction must use, plus its file lists
 *   handoff.ts   - handoff skill resolution, file naming, discovery and retention
 *   command.ts   - the `/context-budget` command: parsing, picker, persistence
 *
 * Commands:
 *   /context-budget [48k|56k|64k|80k|96k|112k|128k|144k|160k|192k|224k|256k|320k|384k|428k|off]
 *     (implemented in `command.ts`)
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
	shortTokens,
} from './budget.ts'
import { STATUS_KEY, registerCeilingCommand } from './command.ts'
import { watchCompaction } from './compaction.ts'
import { ContextGuard, handoffMessage } from './guard.ts'
import { handoffDir, isUsableHandoff, pruneHandoffs } from './handoff.ts'
import { readCeiling } from './store.ts'
import { HandoffSummary } from './summary.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { GuardAction } from './guard.ts'

export default function contextBudget(pi: ExtensionAPI): void {
	const guard = new ContextGuard({
		agentDir: getAgentDir(),
		isWritten: isUsableHandoff,
	})
	// A stale claim from a previous incarnation of this session must not
	// survive the reload: the guard state is rebuilt here, so is the claim.
	endHandoffCycle()
	const summary = new HandoffSummary()
	watchContext(pi, guard)
	watchSettle(pi, guard, summary)
	watchCompaction(pi, guard, summary)
	registerCeilingCommand(pi, guard)
}

/**
 * Send the handoff request: the directive to the path the guard chose, plus
 * one notice. Used where the ceiling is crossed and for the settle re-asks.
 */
function requestHandoff(
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

/** Apply one guard decision: the guard decides, this performs the pi calls. */
function applyAction(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	action: GuardAction,
): void {
	if (action.type === 'clear') {
		// Below the ceiling (or `off`) no cycle can be live: dropping the
		// claim here is what makes `/context-budget off` release the boundary.
		endHandoffCycle()
		ctx.ui.setStatus(STATUS_KEY, undefined)
		return
	}
	ctx.ui.setStatus(STATUS_KEY, action.status)
	if (action.type === 'status' || action.type === 'ready') return
	if (action.type === 'warn') {
		ctx.ui.notify(
			`Context ${shortTokens(action.tokens)} of the ${shortTokens(action.ceiling)} handoff ceiling.`,
			'info',
		)
		return
	}
	if (action.type === 'pending') {
		ctx.ui.notify(
			`Context ceiling reached (${shortTokens(action.tokens)}/${shortTokens(action.ceiling)}) - the handoff will be requested when this run settles.`,
			'warning',
		)
		return
	}
	// `handoff`: past the ceiling - ask now, steering the run out of it.
	requestHandoff(pi, ctx, action)
}

function watchContext(pi: ExtensionAPI, guard: ContextGuard): void {
	pi.on('session_start', (_event, ctx) => {
		guard.enable(readCeiling(getAgentDir()))
		// A fresh or resumed session inherits no claim: the guard restarts,
		// so does the boundary arbitration.
		endHandoffCycle()
		ctx.ui.setStatus(STATUS_KEY, undefined)
		pruneHandoffs(getAgentDir(), ctx.sessionManager.getSessionId())
	})
	pi.on('session_shutdown', (_event, ctx) => {
		ctx.ui.setStatus(STATUS_KEY, undefined)
	})
	pi.on('turn_end', (_event, ctx) => {
		// A handoff only pays off when a human can act on it: delegated
		// subagent runs and scripted `-p` runs have no one to resume, and
		// stopping them to write a handoff would break their caller.
		if (ctx.mode !== 'tui') return
		const usage = ctx.getContextUsage()
		const tokens = usage?.tokens
		if (typeof tokens !== 'number') return
		applyAction(
			pi,
			ctx,
			guard.next(
				tokens,
				ctx.sessionManager.getSessionId(),
				new Date(),
				usage?.contextWindow,
			),
		)
	})
}

/**
 * Replace the conversation with the handoff. pi compacts this session in place
 * - the transcript, the model and the thinking level are untouched - and
 * `watchCompaction` hands the handoff in as the summary of that compaction.
 *
 * The continuation is sent from `onComplete`, because a compaction on its own
 * leaves the agent idle, and an idle agent is the one thing this extension must
 * never produce. It goes out deferred so no run starts inside pi's own
 * compaction callback.
 */
function compactFromHandoff(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	guard: ContextGuard,
	summary: HandoffSummary,
): void {
	ctx.compact({
		onComplete: () => {
			// The prompt was dropped, so the ceiling can be crossed again from
			// a much smaller context: restart the cycle before the continuation
			// runs, otherwise its settle would find this cycle's handoff.
			guard.enable(guard.currentCeiling())
			// The cycle is over: the boundary returns to ordinary arbitration,
			// and goal-gate resumes continuing its checklist at the next settle.
			endHandoffCycle()
			summary.reset()
			// The continuation below can race the compaction being applied: its
			// request may still be built from the pre-compaction context, so the
			// next reading can come back numeric and stale. Skip it (see
			// ContextGuard.noteCompacted) instead of re-crossing the ceiling.
			guard.noteCompacted()
			ctx.ui.setStatus(STATUS_KEY, undefined)
			ctx.ui.notify(
				'Conversation replaced by the handoff - continuing.',
				'info',
			)
			setTimeout(() => {
				// `followUp` never throws while another run is live (a plain send
				// does), and when idle it triggers the turn exactly as before.
				pi.sendUserMessage(continuationText(), {
					deliverAs: 'followUp',
				})
			}, 0)
		},
		onError: error => {
			// The claim never happened, or pi gave up before it: either way the
			// arming must not survive into an unrelated compaction.
			summary.disarm()
			// The boundary is released with the failed cycle; a re-ask or a
			// later compaction attempt claims it afresh.
			endHandoffCycle()
			guard.noteCompactFailed()
			ctx.ui.notify(
				`Compaction from the handoff failed (${error.message}) - staying in this session.`,
				'error',
			)
		},
	})
}

/**
 * The fail-open tail of a cycle whose handoff never appeared: rather than let
 * the session run to the model window and pi's generic summary, compact now
 * with instructions pointed at what a resumption needs. The guard latches the
 * give-up, so this fires once; the boundary is released either way, and
 * goal-gate's ledger gating resumes.
 */
function compactDirected(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	path: string,
): void {
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

/**
 * The chain must not wait for a human. `agent_settled` is the first moment pi
 * will not continue on its own, so that is where the extension takes over:
 * compact from the handoff, re-ask while the file is missing, and report a run
 * that produced none.
 */
function watchSettle(
	pi: ExtensionAPI,
	guard: ContextGuard,
	summary: HandoffSummary,
): void {
	pi.on('agent_settled', (_event, ctx) => {
		// Same gate as the guard: a delegated run has no one to continue.
		if (ctx.mode !== 'tui') return
		// One `agent_settled` dispatch leaves every handler seeing an idle
		// agent - a message another extension queued starts its run
		// asynchronously - so `isIdle()` alone arbitrates nothing. The
		// handshake does: while this extension holds a live claim no other
		// extension queues under it (goal-gate defers), and a run another
		// extension started is one this extension must not steer into.
		if (!ctx.isIdle()) return
		const action = guard.settled()
		if (action.type === 'idle') return
		if (action.type === 'handoff') {
			// The run reached the ceiling and pi will not continue on its own:
			// the boundary is here, so ask now instead of interrupting a turn.
			requestHandoff(pi, ctx, action)
			return
		}
		if (action.type === 'givenUp') {
			compactDirected(pi, ctx, action.path)
			return
		}
		if (action.type === 'reask') {
			// The cycle is still live: keep the boundary claimed (and the
			// claim's TTL fresh) while the re-ask runs.
			beginHandoffCycle()
			pi.sendUserMessage(handoffMessage(action), { deliverAs: 'steer' })
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
		summary.arm(action.path)
		compactFromHandoff(pi, ctx, guard, summary)
	})
}
