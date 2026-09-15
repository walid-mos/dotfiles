/** Quiet right-hand metadata: observed duration, compact timeout cap, and failure status. */
import { uiTheme } from './design-system/theme.ts'
import { terminalLineWidth, truncateTerminalLine } from './terminal-text.ts'

interface ActivityTiming {
	elapsedMs?: number | undefined
	timeoutSeconds?: number | undefined
	failure: string
}

const CLOCK_VIEWPORT_COLUMNS = 56
const WIDE_VIEWPORT_COLUMNS = 80
const FULL_VIEWPORT_COLUMNS = 120
const COMPACT_COLUMNS = 12
const WIDE_COLUMNS = 24
const FULL_COLUMNS = 32
const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60
const TIME_PART_COLUMNS = 2

export function formatActivityDuration(elapsedMs: number | undefined): string {
	if (typeof elapsedMs !== 'number') return ''
	const seconds = Math.max(0, elapsedMs) / MS_PER_SECOND
	if (seconds < SECONDS_PER_MINUTE) return `${seconds.toFixed(1)}s`
	const minutes = Math.floor(seconds / SECONDS_PER_MINUTE)
	if (minutes < MINUTES_PER_HOUR)
		return `${String(minutes)}m${String(Math.floor(seconds % SECONDS_PER_MINUTE)).padStart(TIME_PART_COLUMNS, '0')}s`
	return `${String(Math.floor(minutes / MINUTES_PER_HOUR))}h${String(minutes % MINUTES_PER_HOUR).padStart(TIME_PART_COLUMNS, '0')}m`
}

function joinTiming(parts: readonly string[]): string {
	return parts
		.filter(part => terminalLineWidth(part) > 0)
		.join(uiTheme.fg('dim', ' · '))
}

export function renderActivityTiming(
	timing: ActivityTiming,
	width: number,
	available: number,
): string {
	if (width < CLOCK_VIEWPORT_COLUMNS && !timing.failure) return ''
	const regularColumns =
		width >= WIDE_VIEWPORT_COLUMNS ? WIDE_COLUMNS : COMPACT_COLUMNS
	const preferred =
		width >= FULL_VIEWPORT_COLUMNS ? FULL_COLUMNS : regularColumns
	const columns = Math.min(
		width < CLOCK_VIEWPORT_COLUMNS
			? terminalLineWidth(timing.failure)
			: preferred,
		Math.max(0, available),
	)
	if (!columns) return ''
	const elapsed = uiTheme.fg('dim', formatActivityDuration(timing.elapsedMs))
	const timeout =
		typeof timing.timeoutSeconds === 'number'
			? uiTheme.fg('dim', `${String(timing.timeoutSeconds)}s max`)
			: ''
	const choices = [
		joinTiming([elapsed, timeout, timing.failure]),
		joinTiming([elapsed, timing.failure]),
		joinTiming([timeout, timing.failure]),
		timing.failure,
	].filter(part => terminalLineWidth(part) > 0)
	const readable =
		choices.find(part => terminalLineWidth(part) <= columns) ??
		choices.at(-1) ??
		''
	const clipped = truncateTerminalLine(readable, columns, '…')
	return ' '.repeat(columns - terminalLineWidth(clipped)) + clipped
}
