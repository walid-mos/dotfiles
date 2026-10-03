import {
	boundedGoalText,
	MAX_GOAL_ITEMS,
	MAX_GOAL_REQUEST_TEXT,
} from '#lib/goal/state.ts'

import type { GoalItem, GoalSnapshot, GoalState } from '#lib/goal/state.ts'

type GoalEdit = {
	action:
		| 'declare'
		| 'tick'
		| 'block'
		| 'status'
		| 'seed'
		| 'resume'
		| 'activate'
	items?: string[]
	request?: string
	id?: number
	ticks?: { id: number; outcome: string }[]
	reason?: string
}

function snapshot(state: GoalState): GoalSnapshot {
	return {
		items: state.items,
		...(state.request && { request: state.request }),
		...(state.blocked && { blocked: state.blocked }),
	}
}

function requestText(prompt: string | undefined): string | undefined {
	return (
		prompt?.replace(/\s+/g, ' ').trim().slice(0, MAX_GOAL_REQUEST_TEXT) ||
		undefined
	)
}

function declare(
	current: GoalState | undefined,
	rawItems: string[],
): GoalState | undefined {
	const items = rawItems.map(text => boundedGoalText(text, 'item'))
	if (!items.length) throw new Error('goal declare needs at least one item.')
	const existing = current?.items ?? []
	const seen = new Set(existing.map(goalItem => goalItem.text.toLowerCase()))
	const added: GoalItem[] = []
	for (const text of items) {
		if (seen.has(text.toLowerCase())) continue
		seen.add(text.toLowerCase())
		added.push({
			id: (existing.at(-1)?.id ?? 0) + added.length + 1,
			text,
			done: false,
		})
	}
	if (!added.length) return undefined
	if (existing.length + added.length > MAX_GOAL_ITEMS)
		throw new Error(`goal: limit is ${MAX_GOAL_ITEMS} items.`)
	const next: GoalState = {
		...current,
		revision: (current?.revision ?? 0) + 1,
		items: [...existing, ...added],
	}
	delete next.blocked
	return next
}

function tick(
	current: GoalState | undefined,
	id: number | undefined,
	outcome: string | undefined,
): GoalState | undefined {
	if (!current || !Number.isSafeInteger(id))
		throw new Error('goal tick needs a declared item number.')
	const goalItem = current.items.find(entry => entry.id === id)
	if (!goalItem)
		throw new Error(`goal tick: item #${id} is not on this branch.`)
	if (goalItem.done) return undefined
	if (
		goalItem.kind === 'request' &&
		(!current.items.some(entry => entry.kind !== 'request') ||
			current.items.some(
				entry => entry.kind !== 'request' && !entry.done,
			))
	) {
		throw new Error(
			'goal tick: verify and tick every concrete task before closing the request.',
		)
	}
	const verified = boundedGoalText(outcome, 'outcome')
	return {
		...current,
		revision: current.revision + 1,
		items: current.items.map(entry =>
			entry.id === id
				? { ...entry, done: true, outcome: verified }
				: entry,
		),
	}
}

export function prepareTicks(
	current: GoalState | undefined,
	ticks: { id: number; outcome: string }[] | undefined,
): { id: number; outcome: string }[] {
	if (!current || !ticks?.length)
		throw new Error('goal tick needs at least one verified item.')
	const ids = new Set(ticks.map(entry => entry.id))
	if (ids.size !== ticks.length)
		throw new Error('goal tick: each item may appear only once per call.')
	return ticks
		.map(entry => {
			if (!current.items.some(goalItem => goalItem.id === entry.id))
				throw new Error(
					`goal tick: item #${entry.id} is not on this branch.`,
				)
			return {
				id: entry.id,
				outcome: boundedGoalText(entry.outcome, 'outcome'),
			}
		})
		.filter(
			entry =>
				!current.items.some(
					goalItem => goalItem.id === entry.id && goalItem.done,
				),
		)
}

function tickMany(
	current: GoalState | undefined,
	ticks: { id: number; outcome: string }[] | undefined,
): GoalState | undefined {
	if (!current) throw new Error('goal tick needs a declared checklist.')
	const pending = prepareTicks(current, ticks)
	if (!pending.length) return undefined
	const ordered = pending.toSorted((left, right) => {
		const isLeftRequest = current.items.some(
			entry => entry.id === left.id && entry.kind === 'request',
		)
		const isRightRequest = current.items.some(
			entry => entry.id === right.id && entry.kind === 'request',
		)
		return Number(isLeftRequest) - Number(isRightRequest)
	})
	let next = current
	for (const entry of ordered)
		next = tick(next, entry.id, entry.outcome) ?? next
	if (next === current) return undefined
	return next
}

function startNew(
	current: GoalState | undefined,
	prompt: string | undefined,
): GoalState {
	const paused = [...(current?.paused ?? [])]
	if (current?.items.some(goalItem => !goalItem.done))
		paused.push(snapshot(current))
	const request = requestText(prompt)
	return {
		revision: (current?.revision ?? 0) + 1,
		...(request && { request }),
		items: [
			{
				id: 1,
				text: 'Complete the current user request end-to-end (see prompt)',
				done: false,
				kind: 'request',
			},
		],
		paused,
	}
}

function activate(
	current: GoalState | undefined,
	id: number | undefined,
): GoalState {
	if (
		!current ||
		typeof id !== 'number' ||
		!Number.isSafeInteger(id) ||
		!current.paused
	)
		throw new Error('goal activate needs an existing paused goal number.')
	const selected = current.paused[id - 1]
	if (!selected)
		throw new Error('goal activate needs an existing paused goal number.')
	const paused = current.paused.filter(
		(_pausedGoal, index) => index !== id - 1,
	)
	if (current.items.some(goalItem => !goalItem.done))
		paused.push(snapshot(current))
	return {
		revision: current.revision + 1,
		...(selected.request && { request: selected.request }),
		...(selected.blocked && { blocked: selected.blocked }),
		items: selected.items,
		paused,
	}
}

export function changeGoal(
	current: GoalState | undefined,
	params: GoalEdit,
): GoalState | undefined {
	if (params.action === 'seed') return startNew(current, params.request)
	if (params.action === 'activate') return activate(current, params.id)
	if (params.action === 'resume') {
		if (!current?.blocked) return undefined
		const next = { ...current, revision: current.revision + 1 }
		delete next.blocked
		return next
	}
	if (params.action === 'declare') return declare(current, params.items ?? [])
	if (params.action === 'tick') return tickMany(current, params.ticks)
	if (params.action === 'block') {
		if (!current) throw new Error('goal block needs a declared checklist.')
		const reason = boundedGoalText(params.reason, 'reason')
		if (reason === current.blocked) return undefined
		return { ...current, revision: current.revision + 1, blocked: reason }
	}
	return undefined
}
