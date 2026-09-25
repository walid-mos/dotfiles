/** Settle-boundary compaction, checkpoint persistence, and continuation. */

import { getAgentDir } from '@earendil-works/pi-coding-agent'

import {
	beginSettleClaim,
	endSettleClaim,
} from '../settle-handshake/handshake.ts'

import {
	appendCheckpointFailure,
	appendCheckpointResult,
	appendCheckpointStart,
	compactionInstructions,
} from './checkpoint.ts'
import { STATUS_KEY } from './command.ts'
import { completedGoal, goalSnapshot } from './goal.ts'
import { modelKey } from './guard-state.ts'
import { readSummaryModel } from './store.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { CheckpointContext, CompactionReason } from './checkpoint.ts'
import type { GoalCompletion, GoalSnapshot } from './goal.ts'
import type { SettleAction } from './guard-state.ts'
import type { ContextGuard } from './guard.ts'
import type { ToolOutputPruner } from './pruning.ts'

const TOKENS_PER_THOUSAND = 1000

export class CompactionSettler {
	private noticedCompletionAt: number | undefined

	constructor(
		private readonly pi: ExtensionAPI,
		private readonly guard: ContextGuard,
		private readonly pruner: ToolOutputPruner,
	) {}

	register(): void {
		this.pi.on('agent_settled', (_event, ctx) => {
			if (ctx.mode !== 'tui' || !ctx.isIdle()) return
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

	private standDown(ctx: ExtensionContext, completion: GoalCompletion): void {
		this.guard.cancelCycle()
		endSettleClaim()
		ctx.ui.setStatus(STATUS_KEY, undefined)
		if (this.noticedCompletionAt === completion.completedAt) return
		this.noticedCompletionAt = completion.completedAt
		ctx.ui.notify(
			`Goal complete (${completion.path}) - automatic compaction and continuation are idle.`,
			'info',
		)
	}

	private perform(ctx: ExtensionContext, action: SettleAction): void {
		if (action.type === 'idle') return
		const goal = goalSnapshot(
			getAgentDir(),
			ctx.sessionManager.getSessionId(),
		)
		const checkpoint = this.checkpointContext(ctx, action, goal)
		appendCheckpointStart(this.pi, checkpoint)
		beginSettleClaim()
		ctx.ui.notify(
			action.isStrict
				? `Context remained above the ${formatTokens(action.target)} recovery target - running one stricter compaction.`
				: `Context reached ${formatTokens(action.tokensBefore)} - compacting in place.`,
			action.isStrict ? 'warning' : 'info',
		)
		ctx.compact({
			customInstructions: compactionInstructions(goal, action.isStrict),
			onComplete: compactionResult => {
				appendCheckpointResult(this.pi, checkpoint, compactionResult)
				endSettleClaim()
				ctx.ui.setStatus(STATUS_KEY, undefined)
				ctx.ui.notify(
					completionNotice(compactionResult.estimatedTokensAfter),
					'info',
				)
				setTimeout(() => this.continueOpenGoal(ctx), 0)
			},
			onError: error => {
				this.guard.noteCompactionFailed()
				appendCheckpointFailure(this.pi, checkpoint, error)
				endSettleClaim()
				ctx.ui.setStatus(STATUS_KEY, 'context auto-compaction paused')
				ctx.ui.notify(
					`Context compaction failed (${error.message}) - automatic retries are paused; run /compact or reselect /context-budget after correcting it.`,
					'error',
				)
			},
		})
	}

	private checkpointContext(
		ctx: ExtensionContext,
		action: Extract<SettleAction, { type: 'compact' }>,
		goal: GoalSnapshot | undefined,
	): CheckpointContext {
		const reason: CompactionReason = action.isStrict
			? 'recovery'
			: 'threshold'
		const summaryModel = readSummaryModel(getAgentDir())
		return {
			sessionId: ctx.sessionManager.getSessionId(),
			model: modelKey(ctx.model),
			summaryModel: `${summaryModel.provider}/${summaryModel.id}`,
			reason,
			tokensBefore: action.tokensBefore,
			contextWindow: ctx.getContextUsage()?.contextWindow,
			systemPromptChars: ctx.getSystemPrompt().length,
			goal,
			guard: this.guard.snapshot(),
			pruning: this.pruner.currentStats(),
		}
	}

	private continueOpenGoal(ctx: ExtensionContext): void {
		const goal = goalSnapshot(
			getAgentDir(),
			ctx.sessionManager.getSessionId(),
		)
		if (!goal?.open.length || goal.blocked) return
		const [next] = goal.open
		if (!next) return
		this.pi.sendUserMessage(
			`Resume the open goal checklist at its next item: ${next}`,
			{ deliverAs: 'followUp' },
		)
	}
}

function completionNotice(estimatedTokensAfter: number | undefined): string {
	if (typeof estimatedTokensAfter !== 'number') {
		return 'Context compacted; the next measured prompt must reach the recovery target before automatic compaction re-arms.'
	}
	return `Context compacted to an estimated ${formatTokens(estimatedTokensAfter)}; verifying the next measured prompt before re-arming.`
}

function formatTokens(tokens: number): string {
	return `${Math.round(tokens / TOKENS_PER_THOUSAND)}k`
}
