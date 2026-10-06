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

/** Share every text bound beyond this point: one line, at most MAX_GOAL_TEXT characters, never a rejection the model has to retry. */
export function boundedGoalText(
	goalValue: string | undefined,
	field: string,
): string {
	const text = goalValue?.replace(/\s+/g, ' ').trim()
	if (!text) throw new Error(`goal: ${field} must not be empty.`)
	return text.length > MAX_GOAL_TEXT
		? `${text.slice(0, MAX_GOAL_TEXT - 1)}…`
		: text
}

function itemLine(goalItem: GoalItem): string {
	return `#${goalItem.id} ${goalItem.text}${goalItem.outcome ? ` (${goalItem.outcome})` : ''}`
}

function nextOpenItem(state: GoalState): GoalItem | undefined {
	return (
		state.items.find(
			goalItem => !goalItem.done && goalItem.kind !== 'request',
		) ?? state.items.find(goalItem => !goalItem.done)
	)
}

/**
 * What changed between two revisions plus the next open item: the result of a
 * tick or declare, so the full checklist is not re-sent on every call. The
 * full text stays behind `status`.
 */
export function goalDeltaText(
	previous: GoalState | undefined,
	next: GoalState,
): string {
	const before = new Map(
		(previous?.items ?? []).map(goalItem => [goalItem.id, goalItem]),
	)
	const added = next.items.filter(goalItem => !before.has(goalItem.id))
	const ticked = next.items.filter(
		goalItem => goalItem.done && before.get(goalItem.id)?.done === false,
	)
	const checked = next.items.filter(goalItem => goalItem.done).length
	const lines = [
		`Goal ${checked}/${next.items.length} (revision ${next.revision})`,
	]
	if (added.length) lines.push(`Added: ${added.map(itemLine).join('; ')}`)
	if (ticked.length) lines.push(`Ticked: ${ticked.map(itemLine).join('; ')}`)
	if (next.blocked) lines.push(`Blocked: ${next.blocked}`)
	const open = nextOpenItem(next)
	lines.push(
		open
			? `Next: ${itemLine(open)}`
			: 'All items done; use status for the full checklist.',
	)
	return lines.join('\n')
}

/**
 * Per-request projection: open items only, so the model always sees current
 * IDs without the completed history that `status` keeps.
 */
export function goalContextText(state: GoalState): string {
	const open = state.items.filter(goalItem => !goalItem.done)
	const lines = [
		`Goal ${state.items.length - open.length}/${state.items.length} (revision ${state.revision})`,
	]
	if (state.request) lines.push(`Request: ${state.request}`)
	lines.push(
		open.length
			? `Open: ${open.map(itemLine).join('; ')}`
			: 'All items done.',
	)
	if (state.blocked) lines.push(`Blocked: ${state.blocked}`)
	if (state.paused?.length)
		lines.push(`Paused goals: ${state.paused.length} (status lists them).`)
	return lines.join('\n')
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
