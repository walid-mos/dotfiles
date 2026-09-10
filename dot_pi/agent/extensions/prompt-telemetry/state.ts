/**
 * What the current prompt has spent so far, as plain data.
 *
 * Every function takes `nowMs` instead of reading the clock: the line renders
 * from state plus the current time, so there is no tick timer and each
 * transition is unit-testable. Time inside tools and user waits is tracked
 * apart from streamed time, which is the only honest denominator for a rate.
 */

/** Characters per token, used only until the provider reports exact usage. */
const CHARACTERS_PER_TOKEN = 4

/**
 * The line's structural view of pi's stream events: an event kind plus the
 * generated text, never the partial message the provider also sends.
 */
export type StreamDelta = {
	type: string
	delta?: string | undefined
}

/** Token counts the line adds up; pi's `Usage` also carries cost and reasoning. */
export type TokenUsage = {
	input: number
	output: number
	cacheRead: number
	cacheWrite: number
}

/** The only thing a finished turn must expose to be counted. */
export type TurnUsage = {
	role: string
	usage?: TokenUsage | undefined
}

export type PromptTelemetry = {
	/** True while a prompt is tracked; false hides the line. */
	active: boolean
	startedAtMs: number
	/** Freeze time; 0 while the agent is still working. */
	settledAtMs: number
	inputTokens: number
	outputTokens: number
	cacheTokens: number
	/** Streamed characters since the last exact usage report. */
	streamedCharacters: number
	/** Open streaming window start; 0 when no stream is in flight. */
	streamStartedAtMs: number
	/** Closed streaming windows, in milliseconds. */
	streamedMs: number
}

export function idleTelemetry(): PromptTelemetry {
	return {
		active: false,
		startedAtMs: 0,
		settledAtMs: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheTokens: 0,
		streamedCharacters: 0,
		streamStartedAtMs: 0,
		streamedMs: 0,
	}
}

export function startTelemetry(nowMs: number): PromptTelemetry {
	return { ...idleTelemetry(), active: true, startedAtMs: nowMs }
}

/** A new assistant turn begins: the previous turn already reported its usage. */
export function startTurn(
	telemetry: PromptTelemetry,
	nowMs: number,
): PromptTelemetry {
	if (!telemetry.active) return telemetry
	return {
		...telemetry,
		...closeStream(telemetry, nowMs),
		streamedCharacters: 0,
	}
}

export function recordStreamDelta(
	telemetry: PromptTelemetry,
	event: StreamDelta,
	nowMs: number,
): PromptTelemetry {
	if (!telemetry.active) return telemetry
	switch (event.type) {
		case 'start':
			return openStream(telemetry, nowMs)
		case 'text_delta':
		case 'thinking_delta':
		case 'toolcall_delta': {
			const { delta } = event
			if (typeof delta !== 'string') return telemetry
			const streaming = openStream(telemetry, nowMs)
			return {
				...streaming,
				streamedCharacters: streaming.streamedCharacters + delta.length,
			}
		}
		default:
			return telemetry
	}
}

export function recordAssistantUsage(
	telemetry: PromptTelemetry,
	message: TurnUsage,
	nowMs: number,
): PromptTelemetry {
	const { role, usage } = message
	if (!telemetry.active || role !== 'assistant' || !usage) return telemetry
	return {
		...telemetry,
		...closeStream(telemetry, nowMs),
		inputTokens: telemetry.inputTokens + Math.max(0, usage.input),
		outputTokens: telemetry.outputTokens + Math.max(0, usage.output),
		cacheTokens:
			telemetry.cacheTokens +
			Math.max(0, usage.cacheRead) +
			Math.max(0, usage.cacheWrite),
		streamedCharacters: 0,
	}
}

/** The agent stopped: freeze the clock, keep the line until it is discarded. */
export function settleTelemetry(
	telemetry: PromptTelemetry,
	nowMs: number,
): PromptTelemetry {
	if (!telemetry.active) return telemetry
	return {
		...telemetry,
		...closeStream(telemetry, nowMs),
		settledAtMs: nowMs,
		streamedCharacters: 0,
	}
}

/** Drop the tracked prompt: the line disappears until the next one. */
export function stopTelemetry(): PromptTelemetry {
	return idleTelemetry()
}

export function elapsedMs(telemetry: PromptTelemetry, nowMs: number): number {
	if (!telemetry.active) return 0
	return Math.max(0, (telemetry.settledAtMs || nowMs) - telemetry.startedAtMs)
}

export function estimatedOutputTokens(telemetry: PromptTelemetry): number {
	return (
		telemetry.outputTokens +
		Math.ceil(telemetry.streamedCharacters / CHARACTERS_PER_TOKEN)
	)
}

export function hasLiveEstimate(telemetry: PromptTelemetry): boolean {
	return telemetry.streamedCharacters > 0
}

/** Milliseconds the model actually spent streaming, open window included. */
export function streamedMs(telemetry: PromptTelemetry, nowMs: number): number {
	if (telemetry.streamStartedAtMs === 0) return telemetry.streamedMs
	return (
		telemetry.streamedMs + Math.max(0, nowMs - telemetry.streamStartedAtMs)
	)
}

function openStream(
	telemetry: PromptTelemetry,
	nowMs: number,
): PromptTelemetry {
	if (telemetry.streamStartedAtMs !== 0) return telemetry
	return { ...telemetry, streamStartedAtMs: nowMs }
}

function closeStream(
	telemetry: PromptTelemetry,
	nowMs: number,
): Pick<PromptTelemetry, 'streamedMs' | 'streamStartedAtMs'> {
	if (telemetry.streamStartedAtMs === 0)
		return {
			streamedMs: telemetry.streamedMs,
			streamStartedAtMs: 0,
		}
	return {
		streamedMs: streamedMs(telemetry, nowMs),
		streamStartedAtMs: 0,
	}
}
