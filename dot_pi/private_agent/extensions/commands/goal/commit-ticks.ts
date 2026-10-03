/** Save reported evidence on matching tasks; keep request completion after concrete work. */
import { changeGoal } from './edits.ts'

import type { GoalState } from '#lib/goal/state.ts'

type ProposedTick = { id: number; outcome: string }
type RejectedTick = { id: number; reason: string }

function sameTask(
	original: GoalState,
	latest: GoalState | undefined,
	id: number,
): boolean {
	if (!latest || latest.request !== original.request) return false
	const before = original.items.find(goalItem => goalItem.id === id)
	const now = latest.items.find(goalItem => goalItem.id === id)
	return Boolean(
		before && now && before.text === now.text && before.kind === now.kind,
	)
}

function separateRequest(
	latest: GoalState | undefined,
	applicable: ProposedTick[],
): { toSave: ProposedTick[]; rejected: RejectedTick[] } {
	const rejected: RejectedTick[] = []
	const isRequestReady = !latest?.items.some(
		goalItem =>
			goalItem.kind !== 'request' &&
			!goalItem.done &&
			!applicable.some(proposed => proposed.id === goalItem.id),
	)
	const toSave = applicable.filter(proposed => {
		const isRequest = latest?.items.some(
			goalItem =>
				goalItem.id === proposed.id && goalItem.kind === 'request',
		)
		if (!isRequest || isRequestReady) return true
		rejected.push({
			id: proposed.id,
			reason: 'request waits for unfinished tasks',
		})
		return false
	})
	return { toSave, rejected }
}

export function applyAcceptedTicks(
	original: GoalState,
	latest: GoalState | undefined,
	accepted: ProposedTick[],
): {
	next: GoalState | undefined
	applied: number[]
	alreadyDone: number[]
	rejected: RejectedTick[]
} {
	const applicable: ProposedTick[] = []
	const alreadyDone: number[] = []
	const rejected: RejectedTick[] = []
	for (const proposed of accepted) {
		if (!sameTask(original, latest, proposed.id)) {
			rejected.push({
				id: proposed.id,
				reason: 'goal changed; recheck this item',
			})
			continue
		}
		if (
			latest?.items.some(
				goalItem => goalItem.id === proposed.id && goalItem.done,
			)
		) {
			alreadyDone.push(proposed.id)
			continue
		}
		applicable.push(proposed)
	}
	const request = separateRequest(latest, applicable)
	const { toSave } = request
	rejected.push(...request.rejected)
	const next =
		latest && toSave.length
			? changeGoal(latest, { action: 'tick', ticks: toSave })
			: undefined
	return {
		next,
		applied: toSave.map(proposed => proposed.id),
		alreadyDone,
		rejected,
	}
}
