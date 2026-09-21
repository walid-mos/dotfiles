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
 * The checklist is written through the `goal` tool (`tool.ts`) rather than by
 * hand-editing the file: declaring, ticking and blocking each ride a turn the
 * model is already running, so the bookkeeping costs no extra request and the
 * ledger's format has one owner. The policy that asks for it lives in
 * AGENTS.md (# Task completion) and in the tool's own description, which is
 * re-sent on every turn - there is no third copy injected into the prompt.
 *
 * A run that stops blocked - or that ignores the whole continuation budget -
 * has still asked the human nothing, and both settle exactly like a finished
 * run. The gate answers that with one escalation: a follow-up whose only demand
 * is the blocking question, raised with `ask_user_question`. That tool's prompt
 * is what marks the pane blocked and tells the human, in one glance, that the
 * work is unfinished and what to answer.
 *
 * The settle boundary is shared: `context-budget` claims it through
 * `extensions/settle-handshake/` while a handoff cycle is live (the handoff
 * replaces the conversation and carries the goal state, so it must go first).
 * The gate evaluates the ledger before any of that machinery: a completed
 * checklist ends the session - no continuation, and context-budget (which
 * runs the same ledger check before it requests, re-asks or compacts) stands
 * down with it. Only with work still open does the claim defer this gate's
 * continuation, without spending its attempt budget; the next settle after
 * the compaction continues the checklist as usual.
 *
 * Modules:
 *   ledger.ts       - path, item syntax, open items (pure)
 *   ledger-edits.ts - declare, tick, block: what each `goal` call produces (pure)
 *   tool.ts         - the `goal` tool: schema, wording, dispatch
 *   directive.ts    - the continuation and escalation texts (pure)
 *   gate.ts         - the settle state machine (pure, injected probe)
 *   question-discussion-pause.ts - suppresses continuation while chat owns the decision
 *
 * Commands:
 *   /goal <item>; <item>  - declare or replace this session's checklist
 *   /goal-clear           - drop it and stand the gate down
 */

import {
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'

import { getAgentDir } from '@earendil-works/pi-coding-agent'

import { QUESTIONNAIRE_MODE_EVENT } from '../ask-user-question/questionnaire-events.ts'
import { isHandoffCycleActive } from '../settle-handshake/handshake.ts'

import { askText, continueText } from './directive.ts'
import { GoalGate } from './gate.ts'
import { inheritedLedger } from './inherit.ts'
import {
	expiredLedgers,
	goalsDir,
	ledgerPath,
	ledgerStatus,
	renderLedger,
	splitItems,
} from './ledger.ts'
import { QuestionDiscussionPause } from './question-discussion-pause.ts'
import { registerGoalTool } from './tool.ts'

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { LedgerFile } from './ledger.ts'

/** Sentinel for a file that vanished between `readdir` and `stat`. */
const MISSING_MODIFICATION_TIME = 0

export default function goalGate(pi: ExtensionAPI): void {
	const gate = new GoalGate({ agentDir: getAgentDir(), read: readLedger })
	const questionDiscussion = new QuestionDiscussionPause()
	pi.events.on(QUESTIONNAIRE_MODE_EVENT, mode =>
		questionDiscussion.update(mode),
	)
	watchSessions(pi, gate, questionDiscussion)
	watchSettle(pi, gate, questionDiscussion)
	registerGoalTool(pi, {
		path: () => gate.ledgerFile,
		read: readLedger,
		write: writeLedger,
		reopen: () => gate.noteNewWork(),
	})
	registerGoalCommands(pi, gate)
}

/** Ledger text at `path`, or undefined when there is nothing readable there. */
function readLedger(path: string): string | undefined {
	try {
		const text = readFileSync(path, 'utf8')
		if (!text.trim()) return undefined
		return text
	} catch {
		return undefined
	}
}

/** Write ledger text, creating the goals directory the first time. */
function writeLedger(path: string, text: string): void {
	mkdirSync(goalsDir(getAgentDir()), { recursive: true })
	writeFileSync(path, text)
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
		if (event.source === 'interactive') gate.noteHumanPrompt()
	})
	// A live prompt means a human is answering right now: whatever budget the
	// previous cycle spent, the situation has changed - the answered question is
	// exactly what the escalation was asking for.
	pi.on('ui_prompt_start', (_event, ctx) => {
		if (ctx.mode === 'tui') gate.noteHumanPrompt()
	})
}

/** Best effort: an unwritable directory must not take the session down. */
function ensureGoalsDir(): void {
	try {
		mkdirSync(goalsDir(getAgentDir()), { recursive: true })
	} catch {
		// Reading a ledger that cannot exist is already handled: the gate idles.
	}
}

/** Drop the ledgers past the retention window, never this session's own. */
function pruneLedgers(activePath: string): void {
	const dir = goalsDir(getAgentDir())
	const expired = expiredLedgers(
		ledgerFiles(dir),
		Date.now(),
		basename(activePath),
	)
	for (const name of expired) {
		rmSync(join(dir, name), { force: true })
	}
}

/** Every file in the goals directory with its modification time. */
function ledgerFiles(dir: string): LedgerFile[] {
	let names: string[]
	try {
		names = readdirSync(dir)
	} catch {
		// No directory yet: there is nothing to prune.
		return []
	}
	const entries: LedgerFile[] = []
	for (const name of names) {
		const modifiedAt = modifiedTime(join(dir, name))
		if (modifiedAt) entries.push({ name, modifiedAt })
	}
	return entries
}

/** Modification time in milliseconds, or 0 when the file vanished or is unreadable. */
function modifiedTime(path: string): number {
	try {
		return statSync(path).mtimeMs
	} catch {
		return MISSING_MODIFICATION_TIME
	}
}

/**
 * The chain must not wait for a human. `agent_settled` is the first moment pi
 * will not continue on its own, so that is where the gate takes over - except
 * when another extension already did: `ctx.isIdle()` is false as soon as one of
 * them started a run here, and that run owns the next turn.
 *
 * `isIdle()` alone arbitrates nothing between extensions queued from the same
 * dispatch: a message's run starts asynchronously, so every handler still sees
 * an idle agent. The handshake does - a live context-budget handoff cycle owns
 * this boundary, and a continuation queued under it would race the compaction
 * that replaces the conversation (observed 2026-09-19: interleaved re-asks,
 * continuations and compactions burned both budgets into an error storm). The
 * handoff carries the goal state, so deferring loses nothing: `settled()` is
 * not called, the attempt budget is untouched, and the next settle continues
 * the checklist as usual.
 */
function watchSettle(
	pi: ExtensionAPI,
	gate: GoalGate,
	questionDiscussion: QuestionDiscussionPause,
): void {
	pi.on('agent_settled', (_event, ctx) => {
		// A delegated or scripted run has no one to continue it, and hijacking
		// one would break its caller.
		if (ctx.mode !== 'tui') return
		if (!ctx.isIdle()) return
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
		if (isHandoffCycleActive()) {
			ctx.ui.notify(
				'Context handoff in progress - the goal continuation waits until it is done.',
				'info',
			)
			return
		}
		perform(pi, ctx, gate.settled())
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
