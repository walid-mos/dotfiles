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
 * The checklist path is injected into every turn's system prompt because the
 * decision this guards happens at the end of a turn, after dozens of turns have
 * pushed any global instruction file to the back of the context.
 *
 * The settle boundary is shared: `context-budget` claims it through
 * `extensions/settle-handshake/` while a handoff cycle is live (the handoff
 * replaces the conversation and carries the goal state, so it must go first).
 * While the claim is live this gate defers its continuation without spending
 * its attempt budget; the next settle after the compaction continues the
 * checklist as usual.
 *
 * Modules:
 *   ledger.ts    - path, item syntax, open items (pure)
 *   directive.ts - the injected contract and the continuation text (pure)
 *   gate.ts      - the settle state machine (pure, injected probe)
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

import { isHandoffCycleActive } from '../settle-handshake/handshake.ts'

import { contractText, continueText } from './directive.ts'
import { GoalGate } from './gate.ts'
import {
	expiredLedgers,
	goalsDir,
	ledgerStatus,
	renderLedger,
	splitItems,
} from './ledger.ts'

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
	watchSessions(pi, gate)
	injectContract(pi, gate)
	watchSettle(pi, gate)
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

function writeLedger(path: string, items: string[]): void {
	mkdirSync(goalsDir(getAgentDir()), { recursive: true })
	writeFileSync(path, renderLedger(items))
}

/**
 * The ledger path is session-scoped, so it is resolved at session start, and the
 * directory is created there: the agent writes the checklist with its own file
 * tool, and a missing parent must not be the reason a goal goes untracked.
 *
 * The attempt budget is reset by a human prompt - by the time someone has typed
 * "continue", the earlier budget is spent on a different situation - but never
 * by the continuation this extension sends itself, which arrives with
 * `source: "extension"`.
 */
function watchSessions(pi: ExtensionAPI, gate: GoalGate): void {
	pi.on('session_start', (_event, ctx) => {
		ensureGoalsDir()
		const activePath = gate.arm(ctx.sessionManager.getSessionId())
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
 * The contract goes last in the system prompt: it is the last thing read before
 * the model decides what to do, which is where a rule about stopping belongs.
 */
function injectContract(pi: ExtensionAPI, gate: GoalGate): void {
	pi.on('before_agent_start', event => {
		const path = gate.ledgerFile
		if (!path) return
		return {
			systemPrompt: `${event.systemPrompt}\n\n${contractText(path)}`,
		}
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
 * an idle agent. The handshake does - a live context-budget handoff cycle owns
 * this boundary, and a continuation queued under it would race the compaction
 * that replaces the conversation (observed 2026-09-19: interleaved re-asks,
 * continuations and compactions burned both budgets into an error storm). The
 * handoff carries the goal state, so deferring loses nothing: `settled()` is
 * not called, the attempt budget is untouched, and the next settle continues
 * the checklist as usual.
 */
function watchSettle(pi: ExtensionAPI, gate: GoalGate): void {
	pi.on('agent_settled', (_event, ctx) => {
		// A delegated or scripted run has no one to continue it, and hijacking
		// one would break its caller.
		if (ctx.mode !== 'tui') return
		if (!ctx.isIdle()) return
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
	if (action.type === 'stopped') {
		ctx.ui.notify(
			action.cause === 'blocked'
				? `Goal blocked - ${action.reason}. Ledger: ${action.path}`
				: `Goal gate stopped - ${action.reason}. Ledger: ${action.path}`,
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
			writeLedger(path, items)
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
