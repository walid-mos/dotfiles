/**
 * The telemetry line: animated clock, elapsed-time track and token counts.
 *
 * Layout is computed against the real terminal width, so the counts degrade in
 * three steps (full, arrows, output-only) before the clock alone survives a
 * narrow viewport. Only `muted` and `dim` are used: the line belongs to the
 * prompt chrome, not the transcript.
 */

import { terminalLineWidth, truncateTerminalLine } from '../ui/terminal-text.ts'

import {
	elapsedMs,
	estimatedOutputTokens,
	hasLiveEstimate,
	streamedMs,
} from './state.ts'

import type { Theme } from '@earendil-works/pi-coding-agent'
import type { PromptTelemetry } from './state.ts'

/** Four-frame clock; the track head advances on the same phase. */
const CLOCK_FRAMES = ['◴', '◷', '◶', '◵'] as const
const FRAME_MS = 250
/** Spaces reserved around the track: two before it, two either side of the counts. */
const CHROME_WIDTH = 4
const TRACK_HEAD_WIDTH = 3
const MIN_TRACK_WIDTH = 8
const MAX_TRACK_WIDTH = 12
const MS_PER_SECOND = 1_000
const SECONDS_PER_MINUTE = 60
/** Clock fields are zero-padded to two digits (`00:07`). */
const TIME_FIELD_DIGITS = 2
const TOKENS_PER_THOUSAND = 1_000
const TOKENS_PER_MILLION = 1_000_000
/** Counts below ten keep one decimal (`3.4k`), larger ones round (`12k`). */
const COMPACT_DECIMAL_BELOW = 10
const COMPACT_DECIMALS = 1

export function renderTelemetryLine(
	telemetry: PromptTelemetry,
	nowMs: number,
	width: number,
	theme: Theme,
): string {
	const elapsed = elapsedMs(telemetry, nowMs)
	const clock = renderClock(telemetry, elapsed, theme)
	for (const counts of countVariants(telemetry, nowMs, theme)) {
		const room =
			width -
			terminalLineWidth(clock) -
			terminalLineWidth(counts) -
			CHROME_WIDTH
		if (room < MIN_TRACK_WIDTH) continue
		const trackWidth = Math.min(MAX_TRACK_WIDTH, room)
		const breathingRoom = ' '.repeat(room - trackWidth)
		return `${clock}  ${renderTrack(telemetry, elapsed, trackWidth, theme)}${breathingRoom}  ${counts}`
	}
	return truncateTerminalLine(clock, width, '…')
}

function renderClock(
	telemetry: PromptTelemetry,
	elapsed: number,
	theme: Theme,
): string {
	const marker = telemetry.settledAtMs
		? theme.fg('dim', '✓')
		: theme.fg('muted', clockFrame(elapsed))
	return `  ${marker} ${theme.fg('muted', formatElapsed(elapsed))}`
}

function renderTrack(
	telemetry: PromptTelemetry,
	elapsed: number,
	width: number,
	theme: Theme,
): string {
	if (telemetry.settledAtMs) return theme.fg('dim', '─'.repeat(width))
	const headWidth = Math.min(TRACK_HEAD_WIDTH, width)
	const travel = Math.max(1, width - headWidth + 1)
	const head = Math.floor(elapsed / FRAME_MS) % travel
	const before = theme.fg('dim', '─'.repeat(head))
	const pulse = theme.fg('muted', '━'.repeat(headWidth))
	const after = theme.fg('dim', '─'.repeat(width - head - headWidth))
	return `${before}${pulse}${after}`
}

/** Most detailed first; the first variant that fits the width wins. */
function countVariants(
	telemetry: PromptTelemetry,
	nowMs: number,
	theme: Theme,
): readonly string[] {
	const output = estimatedOutputTokens(telemetry)
	if (telemetry.inputTokens + output + telemetry.cacheTokens === 0)
		return [theme.fg('dim', 'waiting for tokens')]
	const estimate = hasLiveEstimate(telemetry) ? '~' : ''
	const rate = formatRate(output, streamedMs(telemetry, nowMs))
	return [
		[
			...(telemetry.inputTokens > 0
				? [`${formatTokens(telemetry.inputTokens)} input`]
				: []),
			`${estimate}${formatTokens(output)} output`,
			...(telemetry.cacheTokens > 0
				? [`${formatTokens(telemetry.cacheTokens)} cache`]
				: []),
			`${rate} tok/s`,
		],
		[
			...(telemetry.inputTokens > 0
				? [`${formatTokens(telemetry.inputTokens)}↓`]
				: []),
			`${estimate}${formatTokens(output)}↑`,
			...(telemetry.cacheTokens > 0
				? [`${formatTokens(telemetry.cacheTokens)}↻`]
				: []),
			`${rate}/s`,
		],
		[`${estimate}${formatTokens(output)} tokens`, `${rate}/s`],
	].map(parts => renderCounts(parts, theme))
}

function renderCounts(parts: readonly string[], theme: Theme): string {
	return parts
		.map(part => theme.fg('muted', part))
		.join(theme.fg('dim', ' · '))
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
