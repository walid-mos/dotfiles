/** Select a retained tail from projected messages, respecting context edits and tool pairs. */
import {
	estimateTokens,
	prepareBranchEntries,
} from '@earendil-works/pi-coding-agent'

import { readCheckpointBudget } from '#lib/context-budget/model.ts'

import type {
	ExtensionContext,
	SessionBeforeCompactEvent,
} from '@earendil-works/pi-coding-agent'

type ProjectedEntry = ReturnType<
	ExtensionContext['sessionManager']['buildSessionProjection']
>['entries'][number]

function retainedBoundary(
	entries: ProjectedEntry[],
	keepRecentTokens: number,
): number {
	let retainedTokens = 0
	for (let index = entries.length - 1; index > 0; index -= 1) {
		const projected = entries[index]
		if (!projected) continue
		retainedTokens += projected.messages.reduce(
			(total, message) => total + estimateTokens(message),
			0,
		)
		// A tool result can only be retained together with its preceding call.
		if (
			retainedTokens >= keepRecentTokens &&
			projected.messages[0]?.role !== 'toolResult'
		)
			return index
	}
	throw new Error(
		'No safe checkpoint cut is available; reduce the retained context budget.',
	)
}

function historicalFiles(
	entries: ProjectedEntry[],
	key: 'readFiles' | 'modifiedFiles',
): string[] {
	return entries.flatMap(({ sourceEntry }) => {
		if (
			sourceEntry.type !== 'branch_summary' &&
			sourceEntry.type !== 'compaction'
		)
			return []
		const { details } = sourceEntry
		if (!details || typeof details !== 'object') return []
		const files: unknown = Reflect.get(details, key)
		return Array.isArray(files)
			? files.filter((file): file is string => typeof file === 'string')
			: []
	})
}

function summarizedPrefix(
	entries: ProjectedEntry[],
): ReturnType<typeof prepareBranchEntries> {
	const prefix = prepareBranchEntries(
		entries
			.filter(entry => entry.sourceEntry.type !== 'compaction')
			.flatMap(entry =>
				entry.messages.map(message => ({
					...entry.sourceEntry,
					type: 'message' as const,
					message,
				})),
			),
	)
	return {
		...prefix,
		fileOps: {
			...prefix.fileOps,
			read: new Set([
				...prefix.fileOps.read,
				...historicalFiles(entries, 'readFiles'),
			]),
			edited: new Set([
				...prefix.fileOps.edited,
				...historicalFiles(entries, 'modifiedFiles'),
			]),
		},
	}
}

export function prepareCheckpoint(
	ctx: ExtensionContext,
): Pick<SessionBeforeCompactEvent, 'preparation' | 'branchEntries'> {
	const branchEntries = ctx.sessionManager.getBranch()
	const entries = ctx.sessionManager
		.buildSessionProjection()
		.entries.filter(entry => entry.messages.length > 0)
	const { keepRecentTokens } = readCheckpointBudget(ctx.model?.contextWindow)
	const boundary = retainedBoundary(entries, keepRecentTokens)
	const kept = entries[boundary]
	if (!kept) throw new Error('Checkpoint boundary is missing.')
	const previous = entries.findLast(
		entry => entry.sourceEntry.type === 'compaction',
	)?.sourceEntry
	const prefix = summarizedPrefix(entries.slice(0, boundary))
	return {
		branchEntries,
		preparation: {
			firstKeptEntryId: kept.sourceEntry.id,
			messagesToSummarize: prefix.messages,
			turnPrefixMessages: [],
			isSplitTurn: false,
			tokensBefore: ctx.getContextUsage()?.tokens ?? prefix.totalTokens,
			...(previous?.type === 'compaction' && {
				previousSummary: previous.summary,
			}),
			fileOps: prefix.fileOps,
			settings: { enabled: false, reserveTokens: 0, keepRecentTokens },
		},
	}
}
