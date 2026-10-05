/** One bounded Context Budget checkpoint; failure never invokes Pi's summarizer. */
import { uuidv7 } from '@earendil-works/pi-ai'

import {
	CHECKPOINT_STARTED_EVENT,
	CHECKPOINT_FINISHED_EVENT,
} from '#lib/context-budget/events.ts'
import { readCheckpointModel } from '#lib/context-budget/model.ts'
import { retainedSkillReads } from '#lib/context-budget/retained-reads.ts'
import { runTimedHook } from '#lib/telemetry/hook-timing.ts'

import { currentCheckpointState } from './current-state.ts'
import { checkpointDecisions } from './decisions.ts'
import { prepareCheckpoint } from './preparation.ts'
import { summaryPrompt } from './prompt.ts'

import type {
	CompactionResult,
	ExtensionAPI,
	ExtensionContext,
	SessionBeforeCompactEvent,
} from '@earendil-works/pi-coding-agent'
import type {
	CheckpointFinished,
	CheckpointReason,
} from '#lib/context-budget/events.ts'

type CheckpointDetails = { readFiles: string[]; modifiedFiles: string[] }
type CheckpointResult = { compaction: CompactionResult<CheckpointDetails> }
type CheckpointRequest = Pick<
	SessionBeforeCompactEvent,
	'type' | 'reason' | 'signal' | 'willRetry' | 'customInstructions'
>
type SummaryResult = { cancel: true } | CheckpointResult

// Output accounting includes reasoning; leave room for a complete checkpoint.
const SUMMARY_TOKENS = 8192
const SUMMARY_TIMEOUT_MS = 180_000
const MILLISECONDS_PER_SECOND = 1000

async function checkpoint(
	event: SessionBeforeCompactEvent,
	ctx: ExtensionContext,
	model: NonNullable<ReturnType<ExtensionContext['modelRegistry']['find']>>,
): Promise<CheckpointResult> {
	const signal = AbortSignal.any([
		event.signal,
		AbortSignal.timeout(SUMMARY_TIMEOUT_MS),
	])
	const response = await ctx.modelRegistry.complete(
		model,
		{
			messages: [
				{
					role: 'user',
					content: [
						{
							type: 'text',
							text: summaryPrompt(
								event,
								currentCheckpointState(ctx),
							),
						},
					],
					timestamp: Date.now(),
				},
			],
		},
		{
			maxTokens: SUMMARY_TOKENS,
			reasoning: 'minimal',
			signal,
			cacheRetention: 'none',
			sessionId: uuidv7(),
		},
	)
	signal.throwIfAborted()
	const summary = response.content
		.filter(part => part.type === 'text')
		.map(part => part.text)
		.join('\n')
		.trim()
	if (response.stopReason !== 'stop' || !summary)
		throw new Error(
			`Checkpoint ${model.provider}/${model.id} failed: ${response.stopReason}; no complete summary was returned.`,
		)
	return {
		compaction: checkpointResult(event, summary, response.usage, ctx.cwd),
	}
}

function checkpointResult(
	event: SessionBeforeCompactEvent,
	summary: string,
	usage: NonNullable<CompactionResult['usage']>,
	cwd: string,
): CompactionResult<CheckpointDetails> {
	const { preparation } = event
	return {
		summary: [
			`Scope: summarized prefix before ${preparation.firstKeptEntryId}, plus a bounded current-evidence snapshot. Newer retained messages override this checkpoint; unobserved work is not evidence it never happened.\n\n${summary}`,
			checkpointDecisions(event.branchEntries),
			retainedSkillReads(event.branchEntries, cwd),
		]
			.filter(Boolean)
			.join('\n\n'),
		firstKeptEntryId: preparation.firstKeptEntryId,
		tokensBefore: preparation.tokensBefore,
		usage,
		details: {
			readFiles: [...preparation.fileOps.read],
			modifiedFiles: [
				...new Set([
					...preparation.fileOps.written,
					...preparation.fileOps.edited,
				]),
			],
		},
	}
}

async function requestCheckpoint(
	event: SessionBeforeCompactEvent,
	ctx: ExtensionContext,
): Promise<CheckpointResult> {
	const name = readCheckpointModel()
	if (!name)
		throw new Error(
			'Configure summaryModel in context-budget.json before checkpointing.',
		)
	const slash = name.indexOf('/')
	const model = ctx.modelRegistry.find(
		name.slice(0, slash),
		name.slice(slash + 1),
	)
	if (!model) throw new Error(`Checkpoint model ${name} is unavailable.`)
	try {
		return await checkpoint(event, ctx, model)
	} catch (cause) {
		if (event.signal.aborted) throw cause
		throw new Error(
			`Checkpoint ${name} failed with a ${SUMMARY_TIMEOUT_MS / MILLISECONDS_PER_SECOND}s deadline: ${cause instanceof Error ? cause.message : String(cause)}`,
			{ cause },
		)
	}
}

export async function createCheckpoint(
	event: CheckpointRequest,
	ctx: ExtensionContext,
	events: ExtensionAPI['events'],
	reason: CheckpointReason,
): Promise<CheckpointResult> {
	events.emit(CHECKPOINT_STARTED_EVENT, {
		startedAtMs: Date.now(),
		reason,
		willRetry: event.willRetry,
	})
	try {
		const checkpointOutput = await runTimedHook(
			'context_checkpoint',
			'context-budget.summary',
			() =>
				requestCheckpoint({ ...event, ...prepareCheckpoint(ctx) }, ctx),
		)
		const finished: CheckpointFinished = {
			endedAtMs: Date.now(),
			reason,
			outcome: 'completed',
			...(checkpointOutput.compaction.usage && {
				usage: checkpointOutput.compaction.usage,
			}),
		}
		events.emit(CHECKPOINT_FINISHED_EVENT, finished)
		return checkpointOutput
	} catch (cause) {
		const finished: CheckpointFinished = {
			endedAtMs: Date.now(),
			reason,
			outcome: event.signal.aborted ? 'aborted' : 'failed',
		}
		events.emit(CHECKPOINT_FINISHED_EVENT, finished)
		throw cause
	}
}

export async function summarize(
	event: SessionBeforeCompactEvent,
	ctx: ExtensionContext,
	events: ExtensionAPI['events'],
): Promise<SummaryResult> {
	try {
		return await createCheckpoint(event, ctx, events, event.reason)
	} catch (cause) {
		if (!event.signal.aborted)
			ctx.ui.notify(
				`Context Budget checkpoint failed; history unchanged, no native fallback. ${cause instanceof Error ? cause.message : String(cause)}`,
				'error',
			)
		return { cancel: true }
	}
}
