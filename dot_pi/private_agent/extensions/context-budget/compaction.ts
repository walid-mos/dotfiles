/** Observe Pi compaction, route checkpoint summaries, and learn overflow limits. */

import { getAgentDir } from '@earendil-works/pi-coding-agent'

import { endSettleClaim } from '../settle-handshake/handshake.ts'

import { shortTokens } from './budget.ts'
import { STATUS_KEY } from './command.ts'
import { modelKey } from './guard-state.ts'
import { readSummaryModel } from './store.ts'
import { CheckpointSummarizer } from './summarizer.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { ContextGuard } from './guard.ts'

const OVERFLOW_ENTRY = 'context-budget-overflow'
const OVERFLOW_ENTRY_VERSION = 1

function reportOverflow(
	pi: ExtensionAPI,
	guard: ContextGuard,
	ctx: ExtensionContext,
	tokensBefore: number,
): void {
	const key = modelKey(ctx.model)
	guard.noteOverflow(tokensBefore, key)
	pi.appendEntry(OVERFLOW_ENTRY, {
		version: OVERFLOW_ENTRY_VERSION,
		at: new Date().toISOString(),
		model: key,
		tokensBefore,
	})
	ctx.ui.notify(
		`Provider refused ${shortTokens(tokensBefore)} context tokens on ${key}; that model's future ceiling is capped below the observed limit.`,
		'warning',
	)
}

export function watchCompaction(pi: ExtensionAPI, guard: ContextGuard): void {
	const summarizer = new CheckpointSummarizer(readSummaryModel(getAgentDir()))
	pi.on('session_before_compact', async (event, ctx) => {
		if (event.reason === 'overflow') {
			reportOverflow(pi, guard, ctx, event.preparation.tokensBefore)
		}
		return summarizer.summarize(event, ctx, guard.compactionIsStrict())
	})
	pi.on('session_compact', (event, ctx) => {
		const isOwned = guard.snapshot()?.phase === 'compacting'
		if (isOwned || event.reason !== 'manual') guard.noteCompacted()
		else guard.cancelCycle()
		endSettleClaim()
		ctx.ui.setStatus(STATUS_KEY, undefined)
	})
	pi.on('session_compact_failed', (event, ctx) => {
		endSettleClaim()
		if (!event.fromExtension && event.reason !== 'overflow') return
		ctx.ui.notify(
			`Context compaction failed: ${event.errorMessage ?? 'aborted'}; existing context was retained.`,
			'error',
		)
	})
}
