// Pure checklist transformations; authorization and persistence stay in manage.ts.
import { boundedGoalText, MAX_GOAL_ITEMS } from '#lib/goal/state.ts'

import type { GoalItem, GoalState } from '#lib/goal/state.ts'

/** Clear active work; completed history and blocked state go with it. */
export function deleteGoal(current: GoalState): GoalState {
	const next: GoalState = {
		...current,
		revision: current.revision + 1,
		items: [],
	}
	delete next.request
	delete next.blocked
	return next
}

/** Keep listed IDs and completed/request history while replacing remaining work. */
export function revisePlan(current: GoalState, rawItems: string[]): GoalState {
	const listed = rawItems.map(text => boundedGoalText(text, 'item'))
	if (!listed.length) throw new Error('goal revise needs at least one item.')
	const byText = new Map(
		current.items.map(goalItem => [goalItem.text.toLowerCase(), goalItem]),
	)
	const kept = new Set<string>()
	let nextId = current.items.reduce(
		(max, goalItem) => Math.max(max, goalItem.id),
		0,
	)
	const plan: GoalItem[] = []
	for (const text of listed) {
		const key = text.toLowerCase()
		if (kept.has(key)) continue
		kept.add(key)
		const existing = byText.get(key)
		if (existing) {
			plan.push(existing)
			continue
		}
		nextId += 1
		plan.push({ id: nextId, text, done: false })
	}
	const history = current.items.filter(
		goalItem =>
			!kept.has(goalItem.text.toLowerCase()) &&
			(goalItem.done || goalItem.kind === 'request'),
	)
	const items = [...plan, ...history]
	if (items.length > MAX_GOAL_ITEMS)
		throw new Error(`goal: limit is ${MAX_GOAL_ITEMS} items.`)
	return { ...current, revision: current.revision + 1, items }
}
