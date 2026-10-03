/** Context Budget settings and checkpoint execution signals on Pi's shared bus. */
export const BUDGET_SAVED_EVENT = 'context-budget:saved.v1'

export const CHECKPOINT_STARTED_EVENT = 'context-budget:checkpoint-started.v1'
export const CHECKPOINT_FINISHED_EVENT = 'context-budget:checkpoint-finished.v1'
export const CHECKPOINT_REASONS = [
	'manual',
	'threshold',
	'overflow',
	'automatic',
] as const
export const CHECKPOINT_OUTCOMES = ['completed', 'failed', 'aborted'] as const
export type CheckpointReason = (typeof CHECKPOINT_REASONS)[number]

/** Reported token counts, without provider pricing fields. */
export type CheckpointUsage = {
	input: number
	output: number
	cacheRead: number
	cacheWrite: number
}

export type CheckpointStarted = {
	startedAtMs: number
	reason: CheckpointReason
	willRetry: boolean
}

export type CheckpointFinished = {
	endedAtMs: number
	reason: CheckpointReason
	outcome: (typeof CHECKPOINT_OUTCOMES)[number]
	usage?: CheckpointUsage
}

export function isCheckpointStarted(
	payload: unknown,
): payload is CheckpointStarted {
	return (
		typeof payload === 'object' &&
		payload !== null &&
		'startedAtMs' in payload &&
		typeof payload.startedAtMs === 'number' &&
		Number.isFinite(payload.startedAtMs) &&
		payload.startedAtMs >= 0 &&
		'reason' in payload &&
		CHECKPOINT_REASONS.some(reason => reason === payload.reason) &&
		'willRetry' in payload &&
		typeof payload.willRetry === 'boolean'
	)
}

function isCheckpointUsage(payload: unknown): payload is CheckpointUsage {
	if (typeof payload !== 'object' || payload === null) return false
	return ['input', 'output', 'cacheRead', 'cacheWrite'].every(key => {
		const tokenCount: unknown = Reflect.get(payload, key)
		return (
			typeof tokenCount === 'number' &&
			Number.isFinite(tokenCount) &&
			tokenCount >= 0
		)
	})
}

export function isCheckpointFinished(
	payload: unknown,
): payload is CheckpointFinished {
	return (
		typeof payload === 'object' &&
		payload !== null &&
		'endedAtMs' in payload &&
		typeof payload.endedAtMs === 'number' &&
		Number.isFinite(payload.endedAtMs) &&
		payload.endedAtMs >= 0 &&
		'reason' in payload &&
		CHECKPOINT_REASONS.some(reason => reason === payload.reason) &&
		'outcome' in payload &&
		CHECKPOINT_OUTCOMES.some(outcome => outcome === payload.outcome) &&
		(!('usage' in payload) || isCheckpointUsage(payload.usage))
	)
}
