/**
 * context-budget - keep long Pi sessions below a user-selected cost ceiling.
 *
 * Old bulky tool results are archived and removed only from provider requests.
 * At the measured ceiling, Pi performs an in-session directed compaction with
 * a configured low-cost summary model and a 20k retained tail. A structured
 * custom entry records the goal, limits,
 * pruning, files, and model usage. Automatic compaction re-arms only after the
 * first real post-compaction prompt is at or below 50% of the effective
 * ceiling, at least 48k of context regrows, and two work turns complete. One
 * stricter recovery pass is allowed; a second ineffective result pauses the
 * cycle instead of looping.
 *
 * Modules:
 *   budget.ts      - pure thresholds and ceiling policy
 *   guard.ts       - measured compaction state machine
 *   guard-state.ts - its public actions, phases, snapshots, and model key
 *   pruning.ts     - recoverable old-tool-output pruning
 *   checkpoint.ts  - structured entries and summary instructions
 *   summarizer.ts  - dedicated summary-model adapter with Pi fallback
 *   settle.ts      - compaction and open-goal continuation
 *   compaction.ts  - Pi compaction/overflow lifecycle
 *   goal.ts        - goal-ledger snapshot and completion gate
 *   command.ts     - `/context-budget`
 *   store.ts       - persisted ceiling
 */

import { getAgentDir } from '@earendil-works/pi-coding-agent'

import {
	beginSettleClaim,
	endSettleClaim,
} from '../settle-handshake/handshake.ts'

import { shortTokens } from './budget.ts'
import { appendPostCompactionMeasurement } from './checkpoint.ts'
import { STATUS_KEY, registerCeilingCommand } from './command.ts'
import { watchCompaction } from './compaction.ts'
import { completedGoal } from './goal.ts'
import { modelKey } from './guard-state.ts'
import { ContextGuard } from './guard.ts'
import { ToolOutputPruner } from './pruning.ts'
import { CompactionSettler } from './settle.ts'
import { readCeiling } from './store.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
	SessionEntry,
} from '@earendil-works/pi-coding-agent'
import type { GuardAction } from './guard-state.ts'

export default function contextBudget(pi: ExtensionAPI): void {
	const guard = new ContextGuard()
	const pruner = new ToolOutputPruner(getAgentDir())
	endSettleClaim()
	pruner.register(pi)
	watchContext(pi, guard)
	new CompactionSettler(pi, guard, pruner).register()
	watchCompaction(pi, guard)
	registerCeilingCommand(pi, guard)
}

function applyAction(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	action: GuardAction,
): void {
	if (action.type === 'clear') {
		endSettleClaim()
		ctx.ui.setStatus(STATUS_KEY, undefined)
		return
	}
	if (action.type === 'baseline') {
		finishBaseline(pi, ctx, action)
		return
	}
	ctx.ui.setStatus(STATUS_KEY, action.status)
	if (action.type === 'status') {
		if (action.shouldClaim) beginSettleClaim()
		return
	}
	if (action.type === 'warn') {
		ctx.ui.notify(
			`Context ${shortTokens(action.tokens)} of the ${shortTokens(action.ceiling)} compaction ceiling.`,
			'info',
		)
		return
	}
	if (action.type === 'pending') {
		beginSettleClaim()
		ctx.ui.notify(
			`Context reached ${shortTokens(action.tokens)}/${shortTokens(action.ceiling)}; this run will compact when it settles.`,
			'warning',
		)
		return
	}
	if (action.type === 'recover') {
		queueRecovery(pi, ctx, action)
		return
	}
	blockAutomation(pi, ctx, action)
}

function finishBaseline(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	action: Extract<GuardAction, { type: 'baseline' }>,
): void {
	endSettleClaim()
	ctx.ui.setStatus(STATUS_KEY, undefined)
	recordMeasurement(pi, ctx, action, action.outcome)
}

function queueRecovery(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	action: Extract<GuardAction, { type: 'recover' }>,
): void {
	beginSettleClaim()
	recordMeasurement(pi, ctx, action, 'recovery')
	ctx.ui.notify(
		`Post-compaction context is ${shortTokens(action.tokens)}, above the ${shortTokens(action.target)} target; one stricter recovery is queued.`,
		'warning',
	)
}

function blockAutomation(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	action: Extract<GuardAction, { type: 'blocked' }>,
): void {
	recordMeasurement(pi, ctx, action, 'blocked')
	ctx.ui.notify(
		`Automatic compaction paused: ${shortTokens(action.tokens)} remains above the ${shortTokens(action.target)} recovery target after the stricter pass. Run /compact or reselect /context-budget after reducing retained context.`,
		'error',
	)
}

function recordMeasurement(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	action: { tokens: number; ceiling: number; target: number },
	outcome: 'accepted' | 'recovery' | 'blocked',
): void {
	appendPostCompactionMeasurement(pi, {
		model: modelKey(ctx.model),
		tokens: action.tokens,
		ceiling: action.ceiling,
		target: action.target,
		outcome,
	})
}

/** Last user-prompt time on the branch; undefined when none can be read. */
function lastUserPromptAt(ctx: ExtensionContext): number | undefined {
	const branch = ctx.sessionManager.getBranch() ?? []
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry: SessionEntry | undefined = branch[index]
		if (!entry || entry.type !== 'message') continue
		if (entry.message.role !== 'user') continue
		const at = Date.parse(String(entry.timestamp))
		if (Number.isFinite(at)) return at
	}
	return undefined
}

/**
 * A completed goal stands the guard down only until the next user prompt: a
 * prompt after `completedAt` reopens the session, so the guard runs again even
 * before a new goal is declared on the ledger.
 */
function standsDown(
	completion: { completedAt: number },
	ctx: ExtensionContext,
): boolean {
	const promptedAt = lastUserPromptAt(ctx)
	if (!promptedAt) return true
	return promptedAt <= completion.completedAt
}

function watchContext(pi: ExtensionAPI, guard: ContextGuard): void {
	pi.on('session_start', (_event, ctx) => {
		guard.enable(readCeiling(getAgentDir()))
		guard.selectModel(modelKey(ctx.model))
		endSettleClaim()
		ctx.ui.setStatus(STATUS_KEY, undefined)
	})
	pi.on('model_select', (event, ctx) => {
		guard.selectModel(modelKey(event.model))
		endSettleClaim()
		ctx.ui.setStatus(STATUS_KEY, undefined)
	})
	pi.on('session_shutdown', (_event, ctx) => {
		guard.cancelCycle()
		endSettleClaim()
		ctx.ui.setStatus(STATUS_KEY, undefined)
	})
	pi.on('turn_end', (_event, ctx) => {
		if (ctx.mode !== 'tui') return
		const completion = completedGoal(
			getAgentDir(),
			ctx.sessionManager.getSessionId(),
		)
		if (completion && standsDown(completion, ctx)) {
			guard.cancelCycle()
			endSettleClaim()
			ctx.ui.setStatus(STATUS_KEY, undefined)
			return
		}
		const usage = ctx.getContextUsage()
		if (typeof usage?.tokens !== 'number') return
		applyAction(
			pi,
			ctx,
			guard.next(usage.tokens, modelKey(ctx.model), usage.contextWindow),
		)
	})
}
