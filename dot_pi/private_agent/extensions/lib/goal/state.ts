import type { SessionEntry } from '@earendil-works/pi-coding-agent'

export const GOAL_STATE_ENTRY = 'pi-goal-state-v1'
/** Router-recorded authorisation for one user-requested goal re-evaluation. */
export const GOAL_CHANGE_AUTHORIZATION_ENTRY = 'pi-goal-manage-v2'
export const MAX_GOAL_ITEMS = 40
/** Local per-field bound, not a Jev limit; its budget covers the full request. */
export const MAX_GOAL_TEXT = 2_000
export const MAX_GOAL_REQUEST_TEXT = 600

export type GoalItem = {
	id: number
	text: string
	done: boolean
	kind?: 'request'
	outcome?: string
}

export type GoalSnapshot = {
	request?: string
	items: GoalItem[]
	blocked?: string
}

export type GoalState = GoalSnapshot & {
	revision: number
	paused?: GoalSnapshot[]
}

export type GoalManageMarker = {
	revision: number
	prompt: string
	truncated: boolean
}

function isGoalManageMarker(candidate: unknown): candidate is GoalManageMarker {
	if (!candidate || typeof candidate !== 'object') return false
	return (
		Number.isSafeInteger(Reflect.get(candidate, 'revision')) &&
		typeof Reflect.get(candidate, 'prompt') === 'string' &&
		typeof Reflect.get(candidate, 'truncated') === 'boolean'
	)
}

function isGoalItem(candidate: unknown): candidate is GoalItem {
	if (!candidate || typeof candidate !== 'object') return false
	return (
		Number.isSafeInteger(Reflect.get(candidate, 'id')) &&
		typeof Reflect.get(candidate, 'text') === 'string' &&
		typeof Reflect.get(candidate, 'done') === 'boolean' &&
		(!Reflect.has(candidate, 'kind') ||
			Reflect.get(candidate, 'kind') === 'request')
	)
}

function isGoalSnapshot(candidate: unknown): candidate is GoalSnapshot {
	if (!candidate || typeof candidate !== 'object') return false
	const items: unknown = Reflect.get(candidate, 'items')
	return (
		Array.isArray(items) &&
		items.length <= MAX_GOAL_ITEMS &&
		items.every(isGoalItem) &&
		(!Reflect.has(candidate, 'request') ||
			typeof Reflect.get(candidate, 'request') === 'string') &&
		(!Reflect.has(candidate, 'blocked') ||
			typeof Reflect.get(candidate, 'blocked') === 'string')
	)
}

function isGoalState(candidate: unknown): candidate is GoalState {
	if (!isGoalSnapshot(candidate)) return false
	const paused: unknown = Reflect.get(candidate, 'paused')
	return (
		Number.isSafeInteger(Reflect.get(candidate, 'revision')) &&
		(!Reflect.has(candidate, 'paused') ||
			(Array.isArray(paused) && paused.every(isGoalSnapshot)))
	)
}

export function activeGoal(branch: SessionEntry[]): GoalState | undefined {
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry = branch[index]
		if (entry?.type !== 'custom' || entry.customType !== GOAL_STATE_ENTRY)
			continue
		if (isGoalState(entry.data)) return entry.data
	}
	return undefined
}

/** Latest explicit human authorisation to re-evaluate goal state on this branch. */
export function manageMarker(
	branch: SessionEntry[],
): GoalManageMarker | undefined {
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry = branch[index]
		if (
			entry?.type !== 'custom' ||
			entry.customType !== GOAL_CHANGE_AUTHORIZATION_ENTRY
		)
			continue
		if (!isGoalManageMarker(entry.data)) return undefined
		return entry.data
	}
	return undefined
}

/** Share every text bound beyond this point. */
export function boundedGoalText(
	goalValue: string | undefined,
	field: string,
): string {
	const text = goalValue?.trim()
	if (!text || text.length > MAX_GOAL_TEXT || /[\r\n]/.test(text)) {
		throw new Error(
			`goal: ${field} must be 1-${MAX_GOAL_TEXT} characters on one line.`,
		)
	}
	return text
}

export function goalText(state: GoalState): string {
	const checked = state.items.filter(goalItem => goalItem.done).length
	const lines = [
		`Goal ${checked}/${state.items.length} (revision ${state.revision})`,
	]
	if (state.request) lines.push(`Request: ${state.request}`)
	for (const goalItem of state.items) {
		lines.push(
			`- [${goalItem.done ? 'x' : ' '}] #${goalItem.id} ${goalItem.text}${goalItem.outcome ? ` (${goalItem.outcome})` : ''}`,
		)
	}
	if (state.blocked) lines.push(`Blocked: ${state.blocked}`)
	for (const [index, paused] of (state.paused ?? []).entries()) {
		lines.push(
			`Paused #${index + 1}: ${paused.request ?? paused.items.find(goalItem => !goalItem.done && goalItem.kind !== 'request')?.text ?? 'Unlabelled goal'}`,
		)
	}
	return lines.join('\n')
}
