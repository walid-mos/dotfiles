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
 * So this extension watches a ceiling the user picks, and at that ceiling it
 * steers a message into the running turn asking the agent to write a resumption
 * handoff while it still holds the whole picture, then stops. Once that file
 * exists and the agent has settled, the extension replaces the conversation
 * with it: the session is compacted in place - the transcript, the model and
 * the thinking level all survive - and the summary given to that compaction is
 * the handoff itself, so none of pi's own summary is ever used. The chain then
 * continues on its own, so it never waits for a human; a run that ends without
 * the file is re-asked, bounded.
 *
 * Modules:
 *   budget.ts    - pure policy: ceilings, levels, injected texts
 *   guard.ts     - the per-turn state machine (pure, injected probes)
 *   store.ts     - the persisted ceiling (`<agentDir>/context-budget.json`)
 *   summary.ts   - the handoff a compaction must use as its summary
 *   handoff.ts   - handoff skill resolution, file naming and discovery
 *
 * Commands:
 *   /context-budget [48k|56k|64k|80k|96k|112k|128k|144k|160k|192k|224k|256k|320k|384k|428k|off]
 */

import { mkdirSync } from 'node:fs'

import { getAgentDir } from '@earendil-works/pi-coding-agent'

import {
	HANDOFF_CHOICES,
	MAX_SETTLE_RETRIES,
	continuationText,
	parseCeiling,
	shortTokens,
} from './budget.ts'
import { ContextGuard, handoffMessage } from './guard.ts'
import { handoffDir, isUsableHandoff, resolveSkillBody } from './handoff.ts'
import { readCeiling, writeCeiling } from './store.ts'
import { HandoffSummary } from './summary.ts'

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { AutocompleteItem } from '@earendil-works/pi-tui'
import type { Ceiling } from './budget.ts'
import type { GuardAction } from './guard.ts'

const STATUS_KEY = 'context-budget'

export default function contextBudget(pi: ExtensionAPI): void {
	const guard = new ContextGuard({
		agentDir: getAgentDir(),
		isWritten: isUsableHandoff,
	})
	const summary = new HandoffSummary()
	watchContext(pi, guard)
	watchSettle(pi, guard, summary)
	watchCompaction(pi, guard, summary)
	registerCeilingCommand(pi, guard)
}

function ceilingLabel(ceiling: Ceiling): string {
	return ceiling === 'off' ? 'off' : shortTokens(ceiling)
}

/** Apply one guard decision: the guard decides, this performs the pi calls. */
function applyAction(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	action: GuardAction,
): void {
	if (action.type === 'clear') {
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
	mkdirSync(handoffDir(getAgentDir()), { recursive: true })
	pi.sendUserMessage(
		handoffMessage(action, resolveSkillBody(pi.getCommands())),
		{ deliverAs: 'steer' },
	)
	ctx.ui.notify(
		`Context ceiling reached (${shortTokens(action.tokens)}/${shortTokens(action.ceiling)}). Handoff requested at ${action.path} - this session compacts from it once it is written.`,
		'warning',
	)
}

function watchContext(pi: ExtensionAPI, guard: ContextGuard): void {
	pi.on('session_start', (_event, ctx) => {
		guard.enable(readCeiling(getAgentDir()))
		ctx.ui.setStatus(STATUS_KEY, undefined)
	})
	pi.on('session_shutdown', (_event, ctx) => {
		ctx.ui.setStatus(STATUS_KEY, undefined)
	})
	pi.on('turn_end', (_event, ctx) => {
		// A handoff only pays off when a human can act on it: delegated
		// subagent runs and scripted `-p` runs have no one to resume, and
		// stopping them to write a handoff would break their caller.
		if (ctx.mode !== 'tui') return
		const tokens = ctx.getContextUsage()?.tokens
		if (typeof tokens !== 'number') return
		applyAction(
			pi,
			ctx,
			guard.next(tokens, ctx.sessionManager.getSessionId(), new Date()),
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
			ctx.ui.setStatus(STATUS_KEY, undefined)
			ctx.ui.notify(
				'Conversation replaced by the handoff - continuing.',
				'info',
			)
			setTimeout(() => {
				pi.sendUserMessage(continuationText())
			}, 0)
		},
		onError: error => {
			// The claim never happened, or pi gave up before it: either way the
			// arming must not survive into an unrelated compaction.
			summary.disarm()
			ctx.ui.notify(
				`Compaction from the handoff failed (${error.message}) - staying in this session.`,
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
		const action = guard.settled()
		if (action.type === 'idle') return
		if (action.type === 'givenUp') {
			ctx.ui.notify(
				`No handoff at ${action.path} after ${MAX_SETTLE_RETRIES} retries - staying in this session. Lower the ceiling with /context-budget or write the handoff by hand.`,
				'error',
			)
			return
		}
		if (action.type === 'reask') {
			pi.sendUserMessage(
				handoffMessage(action, resolveSkillBody(pi.getCommands())),
				{ deliverAs: 'steer' },
			)
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
		summary.arm(action.path)
		compactFromHandoff(pi, ctx, guard, summary)
	})
}

/**
 * Compaction is how this extension replaces the conversation: the same session
 * survives, so nothing has to be carried over, and the summary is the handoff
 * the agent wrote - never pi's own summary of the context being dropped, which
 * is the lossy pass this whole extension exists to avoid.
 */
function watchCompaction(
	pi: ExtensionAPI,
	guard: ContextGuard,
	summary: HandoffSummary,
): void {
	pi.on('session_before_compact', (event, ctx) => {
		const claim = summary.claim()
		if (claim.type === 'idle') return
		if (claim.type === 'missing') {
			// The handoff vanished between the settle check and here. pi's
			// generic summary is not a substitute for it, so the compaction is
			// refused rather than performed with the wrong text.
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
				firstKeptEntryId: preparation.firstKeptEntryId,
				tokensBefore: preparation.tokensBefore,
			},
		}
	})
	// Whatever compacted - this extension or pi's own threshold - the prompt
	// shrank, so the ceiling can be crossed again: restart the guard's cycle.
	pi.on('session_compact', (_event, ctx) => {
		guard.enable(guard.currentCeiling())
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

/** The ceiling requested by an argument or the picker; undefined is cancelled. */
async function chooseCeiling(
	ctx: ExtensionCommandContext,
	args: string,
	current: Ceiling,
): Promise<Ceiling | undefined> {
	const parsed = parseCeiling(args)
	if (parsed) return parsed
	if (args.trim()) {
		ctx.ui.notify(
			`Unrecognised ceiling "${args.trim()}" - use 56k, 96k, 128k, 192k, 256k, 428k, or off`,
			'error',
		)
		return undefined
	}
	const picked = await ctx.ui.select(
		`Context handoff ceiling (now ${ceilingLabel(current)})`,
		[...HANDOFF_CHOICES.map(shortTokens), 'off'],
	)
	if (!picked) return undefined
	return parseCeiling(picked)
}

function argumentCompletions(prefix: string): AutocompleteItem[] | null {
	const matches = [...HANDOFF_CHOICES.map(shortTokens), 'off'].filter(
		option => option.startsWith(prefix),
	)
	if (!matches.length) return null
	return matches.map(option => ({ value: option, label: option }))
}

function registerCeilingCommand(pi: ExtensionAPI, guard: ContextGuard): void {
	pi.registerCommand('context-budget', {
		description:
			'Choose the prompt ceiling that triggers a resumption handoff',
		getArgumentCompletions: argumentCompletions,
		handler: async (args, ctx) => {
			const next = await chooseCeiling(ctx, args, guard.currentCeiling())
			if (!next) return
			writeCeiling(getAgentDir(), next)
			guard.enable(next)
			ctx.ui.setStatus(STATUS_KEY, undefined)
			ctx.ui.notify(
				next === 'off'
					? 'Context handoff ceiling disabled'
					: `Context handoff ceiling set to ${shortTokens(next)}`,
				'info',
			)
		},
	})
}
