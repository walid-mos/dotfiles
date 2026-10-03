/** Read-only, width-safe checklist and item-detail layouts. */
import { uiTheme } from '#lib/ui/design-system/theme.ts'
import {
	blockTitle,
	frameContentWidth,
	framedBlock,
	highlightRow,
} from '#lib/ui/frame.ts'
import {
	truncateTerminalLine,
	wrapTerminalLine,
} from '#lib/ui/terminal-text.ts'

import { goalProgress, nextGoalItem } from './widget.ts'

import type { GoalItem, GoalSnapshot } from '#lib/goal/state.ts'

const VIEW_CENTER_DIVISOR = 2
const LIST_RESERVED_ROWS = 4
const NARROW_PANEL_WIDTH = 32
const DETAIL_RESERVED_ROWS = 4
const SELECTION_MARKER = '▸'

type PanelInput = {
	snapshot: GoalSnapshot
	label: string
	pausedCount: number
	cursor: number
	isDetail: boolean
	detailOffset: number
	isVisible: boolean
	width: number
	height: number
}

function itemRow(input: {
	goalItem: GoalItem
	cursor: number
	position: number
	currentId: number | undefined
	width: number
}): string {
	const { goalItem, cursor, position, currentId, width } = input
	let marker = uiTheme.fg('dim', '○')
	if (goalItem.done) marker = uiTheme.fg('success', '✓')
	else if (goalItem.id === currentId) marker = uiTheme.fg('accent', '●')
	const row = `${uiTheme.fg('accent', cursor === position ? SELECTION_MARKER : ' ')} ${marker} ${uiTheme.fg('muted', `#${String(goalItem.id)}`)}  ${uiTheme.fg(goalItem.done ? 'muted' : 'text', goalItem.text)}`
	return cursor === position
		? highlightRow(row, width)
		: truncateTerminalLine(row, width, '…')
}

function listLines(input: PanelInput, width: number): string[] {
	const { snapshot, cursor, height } = input
	const { fraction, track } = goalProgress(snapshot)
	const lines = [
		`${uiTheme.fg('text', fraction)}  ${track}`,
		...(snapshot.request
			? [uiTheme.fg('muted', `Request  ${snapshot.request}`)]
			: []),
		...(snapshot.blocked
			? [uiTheme.fg('warning', `Blocked  ${snapshot.blocked}`)]
			: []),
	]
	if (!snapshot.items.length)
		return [...lines, uiTheme.fg('muted', 'No items on this checklist.')]
	const capacity = Math.max(1, height - lines.length - LIST_RESERVED_ROWS)
	const first = Math.max(
		0,
		Math.min(
			cursor - Math.floor(capacity / VIEW_CENTER_DIVISOR),
			snapshot.items.length - capacity,
		),
	)
	const currentId = nextGoalItem(snapshot)?.id
	return [
		...lines,
		...snapshot.items
			.slice(first, first + capacity)
			.map((goalItem, index) =>
				itemRow({
					goalItem,
					cursor,
					position: first + index,
					currentId,
					width,
				}),
			),
	]
}

function detailContent(
	snapshot: GoalSnapshot,
	cursor: number,
	width: number,
): string[] {
	const goalItem = snapshot.items[cursor]
	if (!goalItem) return [uiTheme.fg('muted', 'No item selected.')]
	const text =
		goalItem.kind === 'request'
			? (snapshot.request ?? goalItem.text)
			: goalItem.text
	let status = uiTheme.fg('muted', 'Pending')
	if (goalItem.done) status = uiTheme.fg('success', 'Completed')
	else if (goalItem.id === nextGoalItem(snapshot)?.id)
		status = uiTheme.fg('accent', 'Next')
	const lines = [
		`${status}  ${uiTheme.fg('muted', `#${String(goalItem.id)}`)}`,
		'',
		...wrapTerminalLine(text, width).map(line => uiTheme.fg('text', line)),
		...(goalItem.outcome
			? [
					'',
					uiTheme.fg('muted', 'Evidence'),
					...wrapTerminalLine(goalItem.outcome, width).map(line =>
						uiTheme.fg('output', line),
					),
				]
			: []),
	]
	return lines
}

export function maxGoalDetailOffset(
	input: Pick<PanelInput, 'snapshot' | 'cursor' | 'width' | 'height'>,
): number {
	const lines = detailContent(
		input.snapshot,
		input.cursor,
		frameContentWidth(input.width),
	)
	return Math.max(
		0,
		lines.length - Math.max(1, input.height - DETAIL_RESERVED_ROWS),
	)
}

function detailLines(input: PanelInput, width: number): string[] {
	const lines = detailContent(input.snapshot, input.cursor, width)
	return lines.slice(
		input.detailOffset,
		input.detailOffset + Math.max(1, input.height - DETAIL_RESERVED_ROWS),
	)
}

export function renderGoalPanel(input: PanelInput): string[] {
	const width = frameContentWidth(input.width)
	const content = input.isDetail
		? detailLines(input, width)
		: listLines(input, width)
	const suffix = input.pausedCount ? ' · ^p switch goal' : ''
	const visibility = input.isVisible ? 'hide' : 'show'
	let footer = input.isDetail
		? `Esc back · ^h ${visibility} · ↑↓ read${suffix}`
		: `Esc close · ^h ${visibility} · Enter inspect · ↑↓ select${suffix}`
	if (input.width < NARROW_PANEL_WIDTH)
		footer = `Esc  ^h ${visibility}  ${input.isDetail ? '↑↓' : '↵'}`
	return framedBlock({
		width: input.width,
		title: blockTitle('Goal', input.label),
		lines: content,
		footer,
	})
}
