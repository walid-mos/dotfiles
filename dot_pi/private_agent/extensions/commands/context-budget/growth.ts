/** Context Budget checkpoints at a completed tool batch, never waits for agent settlement. */
import {
	checkpointSettingsVersion,
	readCheckpointBudget,
} from '#lib/context-budget/model.ts'

import { createCheckpoint } from './summary.ts'

import type {
	BoundaryResult,
	ExtensionAPI,
	ExtensionContext,
	TurnEndEvent,
} from '@earendil-works/pi-coding-agent'

const CHECKPOINT_OWNER = 'context-budget'
/** Completed tool batches to let pass after a failed checkpoint before trying again. */
const RETRY_AFTER_TURNS = 3

function measuredPromptTokens(
	message: TurnEndEvent['message'],
): number | undefined {
	if (
		message.role !== 'assistant' ||
		message.stopReason === 'error' ||
		message.stopReason === 'aborted' ||
		message.usage.totalTokens <= 0
	)
		return undefined
	return (
		message.usage.input + message.usage.cacheRead + message.usage.cacheWrite
	)
}

export function contextCeiling(ctx: ExtensionContext): number {
	return readCheckpointBudget(ctx.model?.contextWindow).maxContextTokens
}

async function checkpointGrowth(
	ctx: ExtensionContext,
	events: ExtensionAPI['events'],
): Promise<BoundaryResult> {
	const { compaction } = await createCheckpoint(
		{
			type: 'session_before_compact',
			reason: 'manual',
			willRetry: false,
			signal: ctx.signal ?? new AbortController().signal,
		},
		ctx,
		events,
		'automatic',
	)
	return {
		entries: [
			{
				type: 'compaction',
				summary: compaction.summary,
				firstKeptEntryId: compaction.firstKeptEntryId,
				...(compaction.usage && { usage: compaction.usage }),
				details: {
					...compaction.details,
					owner: CHECKPOINT_OWNER,
					ceiling: contextCeiling(ctx),
					model: ctx.model
						? `${ctx.model.provider}/${ctx.model.id}`
						: undefined,
				},
			},
		],
	}
}

class ContextGrowth {
	private needsMeasurement = false
	private failure: string | undefined
	private retryAtTurn: number | undefined
	private settingsVersion: string | undefined

	reset(): void {
		this.needsMeasurement = false
		this.failure = undefined
		this.retryAtTurn = undefined
	}

	retry(): void {
		this.failure = undefined
		this.retryAtTurn = undefined
	}

	compacted(details: unknown): void {
		this.reset()
		this.needsMeasurement = Boolean(
			details &&
			typeof details === 'object' &&
			Reflect.get(details, 'owner') === CHECKPOINT_OWNER,
		)
	}

	restore(ctx: ExtensionContext): void {
		this.reset()
		const branch = ctx.sessionManager.getBranch()
		const checkpointIndex = branch.findLastIndex(
			entry => entry.type === 'compaction',
		)
		const saved = branch[checkpointIndex]
		if (
			saved?.type !== 'compaction' ||
			!saved.details ||
			typeof saved.details !== 'object'
		)
			return
		this.compacted(saved.details)
		if (!this.needsMeasurement) return
		const model = ctx.model
			? `${ctx.model.provider}/${ctx.model.id}`
			: undefined
		if (
			Reflect.get(saved.details, 'model') !== model ||
			Reflect.get(saved.details, 'ceiling') !== contextCeiling(ctx)
		) {
			this.reset()
			return
		}
		const measured = branch
			.slice(checkpointIndex + 1)
			.find(
				entry =>
					entry.type === 'message' &&
					typeof measuredPromptTokens(entry.message) === 'number',
			)
		if (
			measured?.type === 'message' &&
			measured.message.role === 'assistant'
		)
			this.needsMeasurement =
				(measuredPromptTokens(measured.message) ?? 0) >=
				contextCeiling(ctx)
	}

	private refreshSettings(): void {
		const version = checkpointSettingsVersion()
		if (this.settingsVersion && this.settingsVersion !== version)
			this.reset()
		this.settingsVersion = version
	}

	async observe(
		event: TurnEndEvent,
		ctx: ExtensionContext,
		events: ExtensionAPI['events'],
	): Promise<BoundaryResult | undefined> {
		if (
			event.outcome !== 'completed' ||
			event.entries.some(entry => entry.type === 'compaction')
		)
			return undefined
		const tokens = ctx.getContextUsage()?.tokens
		if (typeof tokens !== 'number') return undefined
		this.refreshSettings()
		if (this.isWaitingForRetry(event.turnIndex)) return undefined
		this.retry()
		try {
			const ceiling = contextCeiling(ctx)
			const promptTokens = measuredPromptTokens(event.message)
			if (this.needsMeasurement && typeof promptTokens === 'number')
				this.needsMeasurement = promptTokens >= ceiling
			if (tokens < ceiling) {
				this.needsMeasurement = false
				return undefined
			}
			if (this.needsMeasurement)
				throw new Error(
					'The first measured prompt after checkpointing still exceeds the budget.',
				)
			ctx.ui.notify(
				`Context Budget: ${tokens} tokens exceeds ${ceiling}; saving a checkpoint before the next model call.`,
				'info',
			)
			const checkpointEntries = await checkpointGrowth(ctx, events)
			this.needsMeasurement = true
			return checkpointEntries
		} catch (cause) {
			if (ctx.signal?.aborted) return undefined
			this.recordFailure(cause, event.turnIndex, ctx)
			return undefined
		}
	}

	/** A failed checkpoint waits a few completed tool batches, never a whole human turn. */
	private isWaitingForRetry(turnIndex: number): boolean {
		return Boolean(
			this.failure && this.retryAtTurn && turnIndex < this.retryAtTurn,
		)
	}

	private recordFailure(
		cause: unknown,
		turnIndex: number,
		ctx: ExtensionContext,
	): void {
		this.failure = cause instanceof Error ? cause.message : String(cause)
		this.retryAtTurn = turnIndex + RETRY_AFTER_TURNS
		ctx.ui.notify(
			`Context Budget checkpoint failed; work continues with history unchanged. ${this.failure} Automatic retry after ${RETRY_AFTER_TURNS} more completed tool batches; /context-budget checkpoint retries now. Pi's native summarizer is never used.`,
			'warning',
		)
	}
}

export function registerContextGrowth(pi: ExtensionAPI): void {
	const growth = new ContextGrowth()
	pi.on('session_start', (_event, ctx) => growth.restore(ctx))
	pi.on('session_tree', (_event, ctx) => growth.restore(ctx))
	pi.on('model_select', () => growth.reset())
	pi.on('input', event => {
		if (event.source !== 'extension') growth.retry()
	})
	pi.on('session_compact', event =>
		growth.compacted(event.compactionEntry.details),
	)
	pi.on('turn_end', (event, ctx) => growth.observe(event, ctx, pi.events))
}
