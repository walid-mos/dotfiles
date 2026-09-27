/** Activity hierarchy and stable, responsive columns, shared by tools and compaction. */
import { ACTIVITY_PULSE_MS } from './activity-clock.ts'
import { renderActivityTiming } from './activity-timing.ts'
import { blendHex, foregroundHex } from './design-system/terminal-color.ts'
import { UI_COLOR, uiTheme } from './design-system/theme.ts'
import {
	columnWidth,
	terminalLineWidth,
	truncateTerminalLine,
} from './terminal-text.ts'

export type ActivityPhase =
	| 'queued'
	| 'running'
	| 'success'
	| 'error'
	| 'cancelled'

export interface ActivityLine {
	label: string
	subject: string
	annotation?: string
	summary: string
	warning?: string
	phase: ActivityPhase
	elapsedMs?: number | undefined
	timeoutSeconds?: number | undefined
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const STATUS = {
	queued: { glyph: '◌', tone: 'dim' },
	running: { glyph: '◌', tone: 'accent' },
	success: { glyph: '✓', tone: 'success' },
	error: { glyph: '✕', tone: 'danger' },
	cancelled: { glyph: '⊘', tone: 'warning' },
} as const
const MIN_IDENTITY_COLUMNS = 14
const MAX_IDENTITY_COLUMNS = 28
const IDENTITY_VIEWPORT_SHARE = 0.35
const MAX_COUNT_COLUMNS = 6
const MIN_ACTIVITY_COLUMNS = 9
const SPACING = { status: ' ', column: '  ', body: '   ' } as const
const RAIL_COLUMNS = 2
const STATUS_COLUMNS = 1
const RAIL_STRENGTH = 0.42
const BRANCH_STRENGTH = 0.18

/**
 * Column every activity surface starts its own content on: rows, expanded
 * details and standalone panels share it, so their text lines up vertically.
 */
export const ACTIVITY_CONTENT_COLUMN =
	RAIL_COLUMNS +
	SPACING.status.length +
	STATUS_COLUMNS +
	SPACING.status.length

export const ACTIVITY_RAIL = '│'
export const ACTIVITY_DETAIL_PREFIX =
	ACTIVITY_RAIL + ' '.repeat(ACTIVITY_CONTENT_COLUMN - 1)

const RAIL_INK = blendHex(UI_COLOR.base, UI_COLOR.rail, RAIL_STRENGTH)
const BRANCH_INK = blendHex(UI_COLOR.base, UI_COLOR.rail, BRANCH_STRENGTH)
const BRANCH = foregroundHex(RAIL_INK, '├') + foregroundHex(BRANCH_INK, '─')
const CLOSED_BRANCH =
	foregroundHex(RAIL_INK, '╰') + foregroundHex(BRANCH_INK, '─')
const RAIL_PREFIXES = {
	branch: BRANCH,
	detail: foregroundHex(RAIL_INK, ACTIVITY_DETAIL_PREFIX),
}

export function renderActivityRail(kind: keyof typeof RAIL_PREFIXES): string {
	return RAIL_PREFIXES[kind]
}

export function closeActivityRail(line: string): string {
	if (!line.startsWith(BRANCH))
		return line
	return CLOSED_BRANCH + line.slice(BRANCH.length)
}

export function renderActivityStatus(
	phase: ActivityPhase,
	now: number,
): string {
	const status = STATUS[phase]
	const glyph =
		phase === 'running'
			? (SPINNER_FRAMES[
					Math.floor(now / ACTIVITY_PULSE_MS) % SPINNER_FRAMES.length
				] ?? status.glyph)
			: status.glyph
	return uiTheme.fg(status.tone, glyph)
}

/** Tool name and result count as one identity: the count is right-aligned on a
 * shared column so both the counts and the task text below them line up. */
function activityIdentity(view: ActivityLine, available: number): string {
	const summary =
		view.phase === 'error' || view.phase === 'cancelled' ? '' : view.summary
	const count = summary
		? ` ${uiTheme.fg('dim', truncateTerminalLine(summary, MAX_COUNT_COLUMNS, '…'))}`
		: ''
	const label = uiTheme.bold(uiTheme.fg('accent', view.label))
	const identity = label + count
	const columns = Math.min(
		MAX_IDENTITY_COLUMNS,
		Math.max(MIN_IDENTITY_COLUMNS, terminalLineWidth(identity)),
		Math.max(1, Math.floor(available * IDENTITY_VIEWPORT_SHARE)),
	)
	const padding = ' '.repeat(
		Math.max(0, columns - terminalLineWidth(identity)),
	)
	const clipped = truncateTerminalLine(label + padding + count, columns, '…')
	return clipped + ' '.repeat(columns - terminalLineWidth(clipped))
}

function activityBody(
	view: ActivityLine,
	width: number,
	available: number,
): string {
	const hasFailure = view.phase === 'error' || view.phase === 'cancelled'
	const timing = renderActivityTiming(
		{
			elapsedMs: view.elapsedMs,
			timeoutSeconds: view.timeoutSeconds,
			failure: hasFailure
				? uiTheme.fg(STATUS[view.phase].tone, view.phase)
				: '',
		},
		width,
		available - SPACING.column.length,
	)
	const tail = timing ? SPACING.column + timing : ''
	const subjectColumns = Math.max(0, available - terminalLineWidth(tail))
	const task = [
		uiTheme.fg('output', view.subject),
		view.annotation ? uiTheme.fg('dim', view.annotation) : '',
	]
		.filter(Boolean)
		.join(uiTheme.fg('dim', ' · '))
	const subject = truncateTerminalLine(
		[
			view.warning ? uiTheme.fg('warning', view.warning) : '',
			view.phase === 'error' ? uiTheme.fg('danger', view.summary) : '',
			task,
		]
			.filter(Boolean)
			.join(uiTheme.fg('dim', ' · ')),
		subjectColumns,
		'…',
	)
	return (
		subject + ' '.repeat(subjectColumns - terminalLineWidth(subject)) + tail
	)
}

function activityLead(status: string): string {
	return (
		renderActivityRail('branch') + SPACING.status + status + SPACING.status
	)
}

export function activityNoticeLead(width: number, marker: string): string {
	if (width < MIN_ACTIVITY_COLUMNS) return `${marker} `
	const rail = renderActivityRail('branch')
	return (
		' '.repeat(terminalLineWidth(rail)) +
		activityLead(marker).slice(rail.length)
	)
}

export function renderActivityLine(
	view: ActivityLine,
	width: number,
	now: number,
): string {
	const columns = columnWidth(width)
	const status = renderActivityStatus(view.phase, now)
	if (columns < MIN_ACTIVITY_COLUMNS)
		return truncateTerminalLine(status, columns)
	const lead = activityLead(status)
	const identity = activityIdentity(
		view,
		columns - terminalLineWidth(lead) - SPACING.body.length,
	)
	const prefix = lead + identity + SPACING.body
	const available = Math.max(0, columns - terminalLineWidth(prefix))
	return prefix + activityBody(view, columns, available)
}
