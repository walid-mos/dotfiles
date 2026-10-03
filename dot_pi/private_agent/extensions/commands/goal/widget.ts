/** Two quiet lines above the editor: completion and the next concrete task. */
import { uiTheme } from '#lib/ui/design-system/theme.ts'
import { columnWidth, truncateTerminalLine } from '#lib/ui/terminal-text.ts'

import type { GoalItem, GoalSnapshot, GoalState } from '#lib/goal/state.ts'

const TRACK_WIDTH = 8
const COUNT_DIGITS = 2
const TWO_LINE_MIN_WIDTH = 32
const RAIL = uiTheme.fg('accent', '▏')

export function nextGoalItem(state: GoalSnapshot): GoalItem | undefined {
	return (
		state.items.find(
			goalItem => !goalItem.done && goalItem.kind !== 'request',
		) ?? state.items.find(goalItem => !goalItem.done)
	)
}

function progressTrack(checked: number, total: number): string {
	const filled = Math.round((checked / total) * TRACK_WIDTH)
	return `${uiTheme.fg('accent', '━'.repeat(filled))}${uiTheme.fg('dim', '─'.repeat(TRACK_WIDTH - filled))}`
}

export function goalProgress(state: GoalSnapshot): {
	fraction: string
	track: string
} {
	const checked = state.items.filter(goalItem => goalItem.done).length
	const fraction = `${String(checked).padStart(COUNT_DIGITS, '0')}/${String(state.items.length).padStart(COUNT_DIGITS, '0')}`
	return {
		fraction,
		track: state.items.length
			? progressTrack(checked, state.items.length)
			: '',
	}
}

function nextLine(state: GoalState): { label: string; text: string } {
	if (state.blocked) return { label: 'BLOCKED', text: state.blocked }
	const next = nextGoalItem(state)
	if (!next) return { label: 'DONE', text: 'Checklist complete' }
	if (next.kind === 'request' && state.items.length === 1)
		return { label: 'REQUEST', text: state.request ?? next.text }
	return { label: 'NEXT', text: `#${String(next.id)}  ${next.text}` }
}

export function renderGoalWidget(state: GoalState, width: number): string[] {
	if (!state.items.length || columnWidth(width) === 0) return []
	const { fraction, track } = goalProgress(state)
	const progress = `${uiTheme.fg('accent', uiTheme.bold('GOAL'))}  ${uiTheme.fg('text', fraction)}  ${track}`
	const paused = state.paused?.length
	const badges = [
		...(state.blocked ? [uiTheme.fg('warning', 'blocked')] : []),
		...(paused ? [uiTheme.fg('muted', `${String(paused)} paused`)] : []),
	].join(uiTheme.fg('dim', ' · '))
	const header = `${RAIL}  ${progress}${badges ? `  ${uiTheme.fg('dim', '·')} ${badges}` : ''}`
	if (width < TWO_LINE_MIN_WIDTH)
		return [truncateTerminalLine(header, width, '…')]
	const { label, text } = nextLine(state)
	const second = `${RAIL}  ${uiTheme.fg(state.blocked ? 'warning' : 'muted', label)}  ${uiTheme.fg('output', text)}`
	return [header, second].map(line => truncateTerminalLine(line, width, '…'))
}
