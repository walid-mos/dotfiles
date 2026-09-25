/**
 * goal-gate - a settled run may not leave declared work open.
 *
 * Pi ends a run when the model returns text with no tool call, and it will not
 * continue on its own from there: `agent_settled` is the last moment pi is in
 * charge. Nothing in that loop knows whether the work was finished, so a run
 * that stops three deliverables into four reads exactly like one that is done -
 * the model's own judgement, which is the unreliable part. This extension moves
 * completeness out of that judgement and into a file: the run declares its
 * deliverables in a per-session checklist, and a run that settles with items
 * still open is continued automatically, bounded, until they are closed.
 *
 * The goal tool owns checklist edits. Prompt routing distinguishes answer
 * from work and seeds a request item; after discovery the ledger proposes a
 * scope and Jev reviews the deliverables before delegation. Both decisions
 * are logged without storing the raw human prompt.
 *
 * A run that stops blocked - or that ignores the whole continuation budget -
 * may still have asked the human nothing. The gate answers that with one
 * escalation whose only demand is the blocking question. A questionnaire
 * raised after the latest blocker closes that cycle directly; it must not be
 * followed by another run asking the same question.
 *
 * An explicit abort always wins: when Escape ends a run, the gate leaves the
 * checklist open without injecting another continuation. The next interactive
 * prompt re-arms the normal continuation cycle.
 *
 * The settle boundary is shared: `context-budget` claims it through
 * `extensions/settle-handshake/` while threshold or recovery compaction is
 * live. The gate evaluates the ledger before that machinery: a completed
 * checklist ends the session - no continuation, and context-budget (which
 * runs the same ledger check before compacting) stands down with it. Only
 * with work still open does the claim defer this gate's
 * continuation, without spending its attempt budget; the next settle after
 * the compaction continues the checklist as usual.
 *
 * Modules:
 *   ledger.ts       - path, item syntax, open items (pure)
 *   ledger-edits.ts - declare, tick, dismiss, block: pure checklist edits
 *   ledger-store.ts - filesystem access and retention
 *   routing.ts      - two Jev questions and conservative decisions
 *   task-routing.ts - human-prompt hook and post-declaration review
 *   routing-log.ts  - per-session decision evidence and retention
 *   tool.ts         - the `goal` tool: schema, wording, dispatch
 *   directive.ts    - the continuation and escalation texts (pure)
 *   gate.ts         - the settle state machine (pure, injected probe)
 *   question-discussion-pause.ts - suppresses continuation while chat owns the decision
 *
 * Commands:
 *   /goal <item>; <item>  - declare or replace this session's checklist
 *   /goal-clear           - drop it and stand the gate down
 */

import { rmSync } from 'node:fs'

import { getAgentDir } from '@earendil-works/pi-coding-agent'

import { QUESTIONNAIRE_MODE_EVENT } from '../ask-user-question/questionnaire-events.ts'
import { isSettleClaimActive } from '../settle-handshake/handshake.ts'

import { AgentAbortPause, watchAgentAborts } from './agent-abort-pause.ts'
import { askText, continueText } from './directive.ts'
import { GoalGate } from './gate.ts'
import { inheritedLedger } from './inherit.ts'
import {
	ensureGoalsDir,
	pruneLedgers,
	readLedger,
	writeLedger,
} from './ledger-store.ts'
import { ledgerPath, ledgerStatus, renderLedger, splitItems } from './ledger.ts'
import { QuestionDiscussionPause } from './question-discussion-pause.ts'
import { watchTaskRouting } from './task-routing.ts'
import { registerGoalTool } from './tool.ts'

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'

export default function goalGate(pi: ExtensionAPI): void {
	// Delegated Pi runs report into their parent's ledger; they never own one.
	if (process.env.PI_SUBAGENT_CHILD === '1') return
	const abortPause = new AgentAbortPause()
	const gate = new GoalGate({ agentDir: getAgentDir(), read: readLedger })
	const questionDiscussion = new QuestionDiscussionPause()
	pi.events.on(QUESTIONNAIRE_MODE_EVENT, mode =>
		questionDiscussion.update(mode),
	)
	watchAgentAborts(pi, abortPause)
	watchSessions(pi, gate, questionDiscussion)
	const router = watchTaskRouting(pi, gate, {
		read: readLedger,
		write: writeLedger,
	})
	watchSettle(pi, gate, questionDiscussion, abortPause)
	registerGoalTool(pi, {
		path: () => gate.ledgerFile,
		read: readLedger,
		write: writeLedger,
		reopen: () => gate.noteNewWork(),
		block: () => questionDiscussion.noteBlock(),
		review: router.reviewDeclared,
	})
	registerGoalCommands(pi, gate)
}

/**
 * The ledger path is session-scoped, so it is resolved at session start, and the
 * directory is created there: the `goal` tool and `/goal` both write through
 * `writeLedger`, and a missing parent must not be the reason a goal goes
 * untracked.
 *
 * The attempt budget is reset by a human prompt - by the time someone has typed
 * "continue", the earlier budget is spent on a different situation - but never
 * by the continuation this extension sends itself, which arrives with
 * `source: "extension"`. A live UI prompt counts as one too: the human answering
 * it is exactly what an escalation asked for, so the cycle it was stuck in is
 * over.
 */
function watchSessions(
	pi: ExtensionAPI,
	gate: GoalGate,
	questionDiscussion: QuestionDiscussionPause,
): void {
	pi.on('session_start', (event, ctx) => {
		questionDiscussion.clear()
		ensureGoalsDir()
		const ownPath = ledgerPath(
			getAgentDir(),
			ctx.sessionManager.getSessionId(),
		)
		// A resumed or forked session has no ledger of its own: adopt the one
		// its predecessor was tracking, so the checklist survives the id change.
		const path = readLedger(ownPath)
			? ownPath
			: (inheritedLedger({
					previousSessionFile: event.previousSessionFile,
					agentDir: getAgentDir(),
					read: readLedger,
				}) ?? ownPath)
		const activePath = gate.armLedger(path)
		try {
			pruneLedgers(activePath)
		} catch {
			// Retention is housekeeping: an unreadable directory is not worth
			// failing a session over.
		}
	})
	pi.on('input', event => {
		if (event.source !== 'interactive') return
		gate.noteHumanPrompt()
		questionDiscussion.noteHumanPrompt()
	})
	// A live prompt means a human is answering right now: whatever budget the
	// previous cycle spent, the situation has changed - the answered question is
	// exactly what the escalation was asking for.
	pi.on('ui_prompt_start', (_event, ctx) => {
		if (ctx.mode === 'tui') gate.noteHumanPrompt()
	})
}

/**
 * The chain must not wait for a human. `agent_settled` is the first moment pi
 * will not continue on its own, so that is where the gate takes over - except
 * when another extension already did: `ctx.isIdle()` is false as soon as one of
 * them started a run here, and that run owns the next turn.
 *
 * `isIdle()` alone arbitrates nothing between extensions queued from the same
 * dispatch: a message's run starts asynchronously, so every handler still sees
 * an idle agent. The handshake does - a live context-budget compaction owns
 * this boundary, and a continuation queued under it would race context
 * replacement (observed 2026-09-19: interleaved continuations and compactions
 * burned both budgets into an error storm). The checkpoint carries the goal
 * state, so deferring loses nothing: `settled()` is not called, the attempt
 * budget is untouched, and the next settle continues the checklist as usual.
 */
function watchSettle(
	pi: ExtensionAPI,
	gate: GoalGate,
	questionDiscussion: QuestionDiscussionPause,
	abortPause: AgentAbortPause,
): void {
	pi.on('agent_settled', (_event, ctx) => {
		// A delegated or scripted run has no one to continue it, and hijacking
		// one would break its caller.
		if (ctx.mode !== 'tui') return
		if (!ctx.isIdle()) return
		// Escape is an explicit command to stop. Keep the ledger open, but do not
		// turn that same cancellation into another run for the user to abort.
		if (abortPause.pending) return
		// The goal is evaluated before everything else at this boundary - a
		// completed checklist ends the session: no continuation, and
		// context-budget (which runs the same ledger check before it requests,
		// re-asks or compacts) stands down with it. The probe never touches
		// the cycle state, so nothing is spent here.
		const done = gate.probeDone()
		if (done) {
			ctx.ui.notify(
				`Goal complete: all ${done.total} items at ${done.path} are checked.`,
				'info',
			)
			return
		}
		if (questionDiscussion.pending) return
		if (isSettleClaimActive()) {
			ctx.ui.notify(
				'Context compaction in progress - the goal continuation waits until it is done.',
				'info',
			)
			return
		}
		perform(
			pi,
			ctx,
			gate.settled(
				questionDiscussion.blockingQuestionRaised
					? 'raised'
					: 'unraised',
			),
		)
	})
}

function perform(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	action: ReturnType<GoalGate['settled']>,
): void {
	if (action.type === 'idle') return
	if (action.type === 'done') {
		ctx.ui.notify(
			`Goal complete: all ${action.total} items at ${action.path} are checked.`,
			'info',
		)
		return
	}
	if (action.type === 'ask') {
		pi.sendUserMessage(askText(action), { deliverAs: 'followUp' })
		ctx.ui.notify(
			`Goal blocked - ${action.reason}. Asking the run to raise the question: ${action.status.open.length} of ${action.status.items.length} item(s) still open. Ledger: ${action.path}`,
			'warning',
		)
		return
	}
	if (action.type === 'stopped') {
		const left = `${action.status.open.length} of ${action.status.items.length} item(s) still open`
		ctx.ui.notify(
			action.cause === 'blocked'
				? `Goal blocked - ${action.reason}. ${left}. Ledger: ${action.path}`
				: `Goal gate stopped - ${action.reason}. ${left}. Ledger: ${action.path}`,
			action.cause === 'blocked' ? 'warning' : 'error',
		)
		return
	}
	// `followUp` waits for a run that is still executing and is the plain
	// continuation otherwise: this must never throw mid-settle.
	pi.sendUserMessage(continueText(action), { deliverAs: 'followUp' })
	ctx.ui.notify(
		`Goal still open - continuing (${action.status.open.length} of ${action.status.items.length} items left, attempt ${action.attempt}).`,
		'info',
	)
}

/** What `/goal` reports when it is not declaring anything. */
function reportStatus(ctx: ExtensionCommandContext, gate: GoalGate): void {
	const path = gate.ledgerFile
	const text = path ? readLedger(path) : undefined
	if (!path || !text) {
		ctx.ui.notify(
			'No goal checklist for this session - write one with /goal <item>; <item> or let the run declare it.',
			'info',
		)
		return
	}
	const status = ledgerStatus(text)
	const done = status.items.length - status.open.length
	const tail = status.blocked ? ` - blocked: ${status.blocked}` : ''
	ctx.ui.notify(
		`Goal: ${done}/${status.items.length} items checked${tail}. ${path}`,
		'info',
	)
}

function registerGoalCommands(pi: ExtensionAPI, gate: GoalGate): void {
	pi.registerCommand('goal', {
		description:
			"Declare this session's checklist: a settled run with open items is continued",
		handler: async (args, ctx) => {
			const items = splitItems(args)
			if (!items.length) {
				reportStatus(ctx, gate)
				return
			}
			const path = gate.ledgerFile
			if (!path) return
			writeLedger(path, renderLedger(items))
			// An extension command never reaches the `input` event, so a human
			// declaration has to reset the budget here: a fresh checklist is a fresh
			// situation, not the remains of the run that gave up on the last one.
			gate.noteHumanPrompt()
			ctx.ui.notify(
				`${items.length} item(s) tracked at ${path} - a run that ends with any of them open is continued.`,
				'info',
			)
		},
	})
	pi.registerCommand('goal-clear', {
		description: "Drop this session's checklist and stand the gate down",
		handler: async (_args, ctx) => {
			const path = gate.ledgerFile
			if (!path) return
			rmSync(path, { force: true })
			ctx.ui.notify(`Goal checklist dropped: ${path}`, 'info')
		},
	})
}
