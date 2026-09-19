/**
 * The telemetry block: animated clock, elapsed-time track and token counts.
 *
 * The block is a fixed-width slot per width budget: every number sits in its own
 * right-aligned field and every reading is always rendered, so growing counts
 * change glyphs only - the block never resizes, so a host that positions it once
 * (the editor's top border) never has to move it.
 *
 * Until the provider reports anything the readings do not exist yet, so the
 * track sweeps straight through their columns and names the wait at the row's
 * right edge - same width, same columns, nothing blank.
 *
 * Counts degrade in three steps (full, arrows, output-only) before the clock
 * alone survives a narrow viewport. Painting comes from the host: `data` - the
 * loading color - for the numbers, the tally icons and the clock, a muted
 * `chrome` for the words around them, and the prompt border hue for the track.
 */

import { terminalLineWidth } from '../ui/terminal-text.ts'

import {
	elapsedMs,
	estimatedOutputTokens,
	hasLiveEstimate,
	streamedMs,
} from './state.ts'

import type { PromptTelemetry } from './state.ts'

/** The block's tones; the host supplies them (see `activity-border.ts`). */
export type ActivityPaint = {
	/** Live data, in the loading color: clock, numbers, tally icons, check mark. */
	readonly data: (text: string) => string
	/** The words and separators that describe the data. */
	readonly chrome: (text: string) => string
	/** The elapsed track and its moving head, drawn in the prompt border hue. */
	readonly track: (text: string) => string
}

/**
 * One count reading: a right-aligned number, the icon that stands for it when
 * the viewport is narrow, and the words it is worth when there is room.
 */
type CountReading = {
	readonly token: string
	/** Painted with the number: it carries the reading, not its name. */
	readonly icon?: string | undefined
	/** Painted as chrome: it names the reading. */
	readonly label?: string | undefined
	/** Streamed estimate (`~`) rather than provider-reported usage. */
	readonly isEstimate?: boolean
}

/** Four-frame clock; the track head advances on the same phase. */
const CLOCK_FRAMES = ['◴', '◷', '◶', '◵'] as const
const FRAME_MS = 250
/** Blank columns between the clock, the track and the counts. */
const COUNT_GAP = 2
/** Both gaps: the columns the block spends besides the track and the counts. */
const CHROME_WIDTH = COUNT_GAP + COUNT_GAP
const TRACK_HEAD_WIDTH = 3
const MIN_TRACK_WIDTH = 8
const MAX_TRACK_WIDTH = 12
/** Every number is right-aligned in this many columns: `~999k`, `1.2M`, `81`. */
const VALUE_FIELD_WIDTH = 5
const COUNT_SEPARATOR = ' · '
const WAITING_LABEL = 'waiting for tokens'
/** One blank column keeps the moving head off the wait label. */
const WAIT_LABEL_GAP = 1
const TRACK_DASH = '─'
const TRACK_HEAD = '━'
const MS_PER_SECOND = 1_000
const SECONDS_PER_MINUTE = 60
/** Clock fields are zero-padded to two digits (`00:07`). */
const TIME_FIELD_DIGITS = 2
const TOKENS_PER_THOUSAND = 1_000
const TOKENS_PER_MILLION = 1_000_000
/** Counts below ten keep one decimal (`3.4k`), larger ones round (`12k`). */
const COMPACT_DECIMAL_BELOW = 10
const COMPACT_DECIMALS = 1

/** Fixed-width block for a width budget, or nothing when even the clock is too wide. */
export function renderTelemetryBlock(
	telemetry: PromptTelemetry,
	nowMs: number,
	maxWidth: number,
	paint: ActivityPaint,
): string | undefined {
	const elapsed = elapsedMs(telemetry, nowMs)
	const clock = renderClock(telemetry, elapsed, paint)
	const clockWidth = terminalLineWidth(clock)
	if (clockWidth > maxWidth) return undefined
	const output = estimatedOutputTokens(telemetry)
	// A settled prompt may have reported nothing (aborted, failed): it froze, so
	// it reports zeros rather than waiting for counts that will never arrive.
	const isWaiting =
		!telemetry.settledAtMs &&
		telemetry.inputTokens + output + telemetry.cacheTokens === 0
	for (const readings of countVariants(telemetry, output, nowMs)) {
		const countsWidth = countFieldWidth(readings)
		const room = maxWidth - clockWidth - countsWidth - CHROME_WIDTH
		if (room < MIN_TRACK_WIDTH) continue
		const trackWidth = Math.min(MAX_TRACK_WIDTH, room)
		if (isWaiting)
			return `${clock}  ${renderWaiting(
				trackWidth + COUNT_GAP + countsWidth,
				elapsed,
				paint,
			)}`
		const track = renderTrack(telemetry, elapsed, trackWidth, paint)
		return `${clock}  ${track}  ${renderCounts(readings, paint)}`
	}
	return clock
}

/** Width of a readings row: fixed value fields, fixed glyphs, fixed separators. */
function countFieldWidth(readings: readonly CountReading[]): number {
	const glyphs = readings.reduce(
		(total, reading) =>
			total +
			terminalLineWidth(reading.icon ?? '') +
			terminalLineWidth(reading.label ?? ''),
		0,
	)
	return (
		readings.length * VALUE_FIELD_WIDTH +
		glyphs +
		COUNT_SEPARATOR.length * (readings.length - 1)
	)
}

/**
 * The wait state, from the column the track starts at: no reading exists yet, so
 * the sweep runs through the columns the readings will take and the wait is named
 * at the row's right edge. Width and columns match the reporting state, so the
 * block stays put when the first count lands.
 */
function renderWaiting(
	width: number,
	elapsed: number,
	paint: ActivityPaint,
): string {
	const label = `${' '.repeat(WAIT_LABEL_GAP)}${WAITING_LABEL}`
	const sweepWidth = width - terminalLineWidth(label)
	if (sweepWidth < MIN_TRACK_WIDTH) return renderSweep(width, elapsed, paint)
	return `${renderSweep(sweepWidth, elapsed, paint)}${paint.chrome(label)}`
}

function renderCounts(
	readings: readonly CountReading[],
	paint: ActivityPaint,
): string {
	const separator = paint.chrome(COUNT_SEPARATOR)
	return readings
		.map(reading => renderReading(reading, paint))
		.join(separator)
}

/** One reading: the number, the icon that stands for it, then the words naming it. */
function renderReading(reading: CountReading, paint: ActivityPaint): string {
	const formattedNumber = paint.data(formatValue(reading))
	const icon = reading.icon ? paint.data(reading.icon) : ''
	const label = reading.label ? paint.chrome(reading.label) : ''
	return `${formattedNumber}${icon}${label}`
}

/** Right-aligned number; a reading wider than the field keeps its leading digits. */
function formatValue(reading: CountReading): string {
	const number = reading.isEstimate ? `~${reading.token}` : reading.token
	return number.padStart(VALUE_FIELD_WIDTH, ' ').slice(-VALUE_FIELD_WIDTH)
}

function renderClock(
	telemetry: PromptTelemetry,
	elapsed: number,
	paint: ActivityPaint,
): string {
	const marker = telemetry.settledAtMs
		? paint.data('✓')
		: paint.data(clockFrame(elapsed))
	return `  ${marker} ${paint.data(formatElapsed(elapsed))}`
}

function renderTrack(
	telemetry: PromptTelemetry,
	elapsed: number,
	width: number,
	paint: ActivityPaint,
): string {
	if (telemetry.settledAtMs) return paint.track(TRACK_DASH.repeat(width))
	return renderSweep(width, elapsed, paint)
}

/** Dashes with the moving head on them: the block's only moving part. */
function renderSweep(
	width: number,
	elapsed: number,
	paint: ActivityPaint,
): string {
	const headWidth = Math.min(TRACK_HEAD_WIDTH, width)
	const travel = Math.max(1, width - headWidth + 1)
	const head = Math.floor(elapsed / FRAME_MS) % travel
	const before = TRACK_DASH.repeat(head)
	const pulse = TRACK_HEAD.repeat(headWidth)
	const after = TRACK_DASH.repeat(width - head - headWidth)
	return paint.track(`${before}${pulse}${after}`)
}

/** Most detailed first; the first variant that fits the width wins. */
function countVariants(
	telemetry: PromptTelemetry,
	output: number,
	nowMs: number,
): readonly (readonly CountReading[])[] {
	const input = {
		token: formatTokens(telemetry.inputTokens),
		label: ' input',
	}
	const streamed = {
		token: formatTokens(output),
		label: ' output',
		isEstimate: hasLiveEstimate(telemetry),
	}
	const cache = {
		token: formatTokens(telemetry.cacheTokens),
		label: ' cache',
	}
	const rate = {
		token: formatRate(output, streamedMs(telemetry, nowMs)),
		label: ' tok/s',
	}
	return [
		[input, streamed, cache, rate],
		[
			{ ...input, label: undefined, icon: '↓' },
			{ ...streamed, label: undefined, icon: '↑' },
			{ ...cache, label: undefined, icon: '↻' },
			{ ...rate, label: '/s' },
		],
		[
			{ ...streamed, label: ' tokens' },
			{ ...rate, label: '/s' },
		],
	]
}

function clockFrame(elapsed: number): string {
	const index = Math.floor(elapsed / FRAME_MS) % CLOCK_FRAMES.length
	return CLOCK_FRAMES[index] ?? CLOCK_FRAMES[0]
}

export function formatElapsed(elapsed: number): string {
	const totalSeconds = Math.max(0, Math.floor(elapsed / MS_PER_SECOND))
	const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE)
	const seconds = totalSeconds % SECONDS_PER_MINUTE
	return `${String(minutes).padStart(TIME_FIELD_DIGITS, '0')}:${String(seconds).padStart(TIME_FIELD_DIGITS, '0')}`
}

export function formatTokens(tokens: number): string {
	const safe = Math.max(0, Math.floor(tokens))
	const thousands = safe / TOKENS_PER_THOUSAND
	// Round before picking the unit, so 999_999 reads as 1.0M, not 1000k.
	if (Math.round(thousands) >= TOKENS_PER_THOUSAND)
		return `${compact(safe / TOKENS_PER_MILLION)}M`
	if (thousands >= 1) return `${compact(thousands)}k`
	return String(safe)
}

/** Tokens per second of streamed time; a sub-second stream still divides by one. */
function formatRate(tokens: number, streamed: number): string {
	const seconds = Math.max(1, streamed / MS_PER_SECOND)
	return formatTokens(Math.round(tokens / seconds))
}

function compact(tokens: number): string {
	return tokens >= COMPACT_DECIMAL_BELOW
		? String(Math.round(tokens))
		: tokens.toFixed(COMPACT_DECIMALS)
}
