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
 * A completed goal checklist outranks all of that. Both extensions read the
 * session's ledger (`extensions/goal-gate/`): when every item is checked and
 * no interactive human prompt is newer than that completion, the budget
 * pipeline stands down before it acts - no handoff request, no re-ask, no
 * compaction, no continuation, no LLM call at all. Resuming is the human's
 * decision: the next interactive prompt lifts the stand-down, and a settle
 * still over the ceiling arms the handoff at that point.
 *
 * Modules:
 *   budget.ts    - pure policy: ceilings, levels, clamping, injected texts
 *   guard.ts     - the per-turn state machine (pure, injected probes)
 *   goal.ts      - the goal-completed stand-down (ledger read + decision)
 *   settle.ts    - the settle boundary: ask, re-ask, compact, continue
 *   store.ts     - the persisted ceiling (`<agentDir>/context-budget.json`)
 *   summary.ts   - the handoff a compaction must use, plus its file lists
 *   handoff.ts   - handoff skill resolution, file naming, discovery and retention
 *   command.ts   - the `/context-budget` command: parsing, picker, persistence
 *
 * Commands:
 *   /context-budget [48k|56k|64k|80k|96k|112k|128k|144k|160k|192k|224k|256k|320k|384k|428k|off]
 *     (implemented in `command.ts`)
 */

import { getAgentDir } from '@earendil-works/pi-coding-agent'

import { endHandoffCycle } from '../settle-handshake/handshake.ts'

import { shortTokens } from './budget.ts'
import { STATUS_KEY, registerCeilingCommand } from './command.ts'
import { watchCompaction } from './compaction.ts'
import { completedGoal } from './goal.ts'
import { ContextGuard } from './guard.ts'
import { isUsableHandoff, pruneHandoffs } from './handoff.ts'
import { HandoffSettler, requestHandoff } from './settle.ts'
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
	new HandoffSettler(pi, guard, summary).register()
	watchCompaction(pi, guard, summary)
	registerCeilingCommand(pi, guard)
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
		// A completed checklist ends the session's work: the budget stands
		// down before any warn, mark or steered ask - no prompt is paid for
		// finished work. It stays down until the ledger changes (`goal.ts`).
		if (completedGoal(getAgentDir(), ctx.sessionManager.getSessionId())) {
			ctx.ui.setStatus(STATUS_KEY, undefined)
			return
		}
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
