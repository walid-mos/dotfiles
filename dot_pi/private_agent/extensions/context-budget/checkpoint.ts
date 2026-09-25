/** Structured checkpoint persistence and directed compaction instructions. */

import type {
	CompactionResult,
	ExtensionAPI,
} from '@earendil-works/pi-coding-agent'
import type { GoalSnapshot } from './goal.ts'
import type { GuardSnapshot } from './guard-state.ts'
import type { PruningStats } from './pruning.ts'

const CHECKPOINT_TYPE = 'context-budget-checkpoint'
const CHECKPOINT_VERSION = 1
const MAX_ITEM_CHARS = 300
const MAX_ITEMS = 20
const MAX_FILES = 100
const STRICT_SUMMARY_TOKENS = 2_000
const NORMAL_SUMMARY_TOKENS = 4_000

export type CompactionReason = 'threshold' | 'recovery'

export type CheckpointContext = {
	sessionId: string
	model: string
	summaryModel: string
	reason: CompactionReason
	tokensBefore: number
	contextWindow: number | undefined
	systemPromptChars: number
	goal: GoalSnapshot | undefined
	guard: GuardSnapshot | undefined
	pruning: PruningStats
}

type BoundedGoal = {
	path: string
	completedAt: number | undefined
	blocked: string | undefined
	items: { done: boolean; text: string }[]
}

type CompactionFiles = {
	read: string[]
	modified: string[]
	summaryModel: string | undefined
	keepRecentTokens: number | undefined
}

type CompactUsage = {
	input: number | undefined
	output: number | undefined
	cacheRead: number | undefined
	cacheWrite: number | undefined
	totalTokens: number | undefined
	cost: number | undefined
}

export function appendCheckpointStart(
	pi: ExtensionAPI,
	context: CheckpointContext,
): void {
	pi.appendEntry(CHECKPOINT_TYPE, {
		version: CHECKPOINT_VERSION,
		event: 'started',
		at: new Date().toISOString(),
		...context,
		goal: boundedGoal(context.goal),
	})
}

export function appendCheckpointResult(
	pi: ExtensionAPI,
	context: CheckpointContext,
	compactionResult: CompactionResult,
): void {
	pi.appendEntry(CHECKPOINT_TYPE, {
		version: CHECKPOINT_VERSION,
		event: 'completed',
		at: new Date().toISOString(),
		...context,
		goal: boundedGoal(context.goal),
		result: {
			firstKeptEntryId: compactionResult.firstKeptEntryId,
			tokensBefore: compactionResult.tokensBefore,
			estimatedTokensAfter: compactionResult.estimatedTokensAfter,
			summaryChars: compactionResult.summary.length,
			details: compactionDetails(compactionResult.details),
			usage: compactUsage(compactionResult.usage),
		},
	})
}

export function appendCheckpointFailure(
	pi: ExtensionAPI,
	context: CheckpointContext,
	error: Error,
): void {
	pi.appendEntry(CHECKPOINT_TYPE, {
		version: CHECKPOINT_VERSION,
		event: 'failed',
		at: new Date().toISOString(),
		...context,
		goal: boundedGoal(context.goal),
		error: error.message,
	})
}

export function appendPostCompactionMeasurement(
	pi: ExtensionAPI,
	measurement: {
		model: string
		tokens: number
		ceiling: number
		target: number
		outcome: 'accepted' | 'recovery' | 'blocked'
	},
): void {
	pi.appendEntry(CHECKPOINT_TYPE, {
		version: CHECKPOINT_VERSION,
		event: 'measured',
		at: new Date().toISOString(),
		...measurement,
	})
}

export function compactionInstructions(
	goal: GoalSnapshot | undefined,
	isStrict: boolean,
): string {
	const tokenLimit = isStrict ? STRICT_SUMMARY_TOKENS : NORMAL_SUMMARY_TOKENS
	const lines = [
		`Create a standalone continuation summary no longer than ${tokenLimit} tokens.`,
		'Preserve the active goal and exact next open step, user constraints, decisions with reasons, files changed or inspected, validation outcomes, unresolved errors, async task IDs, and artifact paths.',
		'Reference bulky tool output by its recoverable path instead of copying it. Never include secrets or personal data.',
		'Drop superseded exploration, repeated instructions, stale plans, and completed detail that does not affect the next action.',
	]
	if (isStrict) {
		lines.push(
			'This is a recovery pass after insufficient shrinkage: prefer a terse state snapshot over narrative history.',
		)
	}
	const goalLines = goalProjection(goal)
	if (goalLines.length) {
		lines.push('', 'Authoritative goal ledger:', ...goalLines)
	}
	return lines.join('\n')
}

function goalProjection(goal: GoalSnapshot | undefined): string[] {
	if (!goal) return []
	const lines = [`Ledger: ${goal.path}`]
	if (goal.blocked) lines.push(`Blocked: ${boundedText(goal.blocked)}`)
	for (const goalItem of goal.items.slice(0, MAX_ITEMS)) {
		lines.push(
			`- [${goalItem.done ? 'x' : ' '}] ${boundedText(goalItem.text)}`,
		)
	}
	return lines
}

function boundedGoal(goal: GoalSnapshot | undefined): BoundedGoal | undefined {
	if (!goal) return undefined
	return {
		path: goal.path,
		completedAt: goal.completedAt,
		blocked: goal.blocked ? boundedText(goal.blocked) : undefined,
		items: goal.items.slice(0, MAX_ITEMS).map(goalItem => ({
			done: goalItem.done,
			text: boundedText(goalItem.text),
		})),
	}
}

function boundedText(text: string): string {
	return text.length <= MAX_ITEM_CHARS
		? text
		: `${text.slice(0, MAX_ITEM_CHARS)}…`
}

function compactionDetails(details: unknown): CompactionFiles | undefined {
	if (typeof details !== 'object' || details === null) return undefined
	return {
		read: stringArray(Reflect.get(details, 'readFiles')),
		modified: stringArray(Reflect.get(details, 'modifiedFiles')),
		summaryModel: stringField(details, 'summaryModel'),
		keepRecentTokens: numericField(details, 'keepRecentTokens'),
	}
}

function stringArray(candidate: unknown): string[] {
	if (!Array.isArray(candidate)) return []
	return candidate
		.filter((filePath): filePath is string => typeof filePath === 'string')
		.slice(0, MAX_FILES)
}

function stringField(source: unknown, key: string): string | undefined {
	if (typeof source !== 'object' || source === null) return undefined
	const candidate = Reflect.get(source, key)
	if (typeof candidate !== 'string') return undefined
	return candidate
}

function compactUsage(usage: unknown): CompactUsage | undefined {
	if (typeof usage !== 'object' || usage === null) return undefined
	return {
		input: numericField(usage, 'input'),
		output: numericField(usage, 'output'),
		cacheRead: numericField(usage, 'cacheRead'),
		cacheWrite: numericField(usage, 'cacheWrite'),
		totalTokens: numericField(usage, 'totalTokens'),
		cost: numericField(Reflect.get(usage, 'cost'), 'total'),
	}
}

function numericField(source: unknown, key: string): number | undefined {
	if (typeof source !== 'object' || source === null) return undefined
	const candidate = Reflect.get(source, key)
	if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
		return undefined
	}
	return candidate
}
