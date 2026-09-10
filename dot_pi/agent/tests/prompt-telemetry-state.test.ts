import assert from 'node:assert/strict'
import test from 'node:test'

import {
	elapsedMs,
	estimatedOutputTokens,
	hasLiveEstimate,
	idleTelemetry,
	recordAssistantUsage,
	recordStreamDelta,
	settleTelemetry,
	startTelemetry,
	startTurn,
	stopTelemetry,
	streamedMs,
} from '../extensions/prompt-telemetry/state.ts'

import type {
	TokenUsage,
	TurnUsage,
} from '../extensions/prompt-telemetry/state.ts'

function delta(type: string, length: number): { type: string; delta: string } {
	return { type, delta: 'x'.repeat(length) }
}

function assistantMessage(usage?: TokenUsage): TurnUsage {
	return usage ? { role: 'assistant', usage } : { role: 'assistant' }
}

const USAGE: TokenUsage = {
	input: 12_000,
	output: 3_400,
	cacheRead: 7_000,
	cacheWrite: 1_100,
}

void test('idle telemetry reports no elapsed time and no tokens', () => {
	const idle = idleTelemetry()
	assert.equal(idle.active, false)
	assert.equal(elapsedMs(idle, 5_000), 0)
	assert.equal(estimatedOutputTokens(idle), 0)
})

void test('startTelemetry activates the clock at the given time', () => {
	const started = startTelemetry(1_000)
	assert.equal(started.active, true)
	assert.equal(elapsedMs(started, 1_000), 0)
	assert.equal(elapsedMs(started, 42_000), 41_000)
})

void test('stream deltas count output characters, other events do not', () => {
	let telemetry = startTelemetry(0)
	telemetry = recordStreamDelta(telemetry, { type: 'start' }, 500)
	telemetry = recordStreamDelta(telemetry, delta('text_delta', 40), 1_000)
	telemetry = recordStreamDelta(telemetry, delta('thinking_delta', 20), 1_000)
	telemetry = recordStreamDelta(telemetry, delta('toolcall_delta', 4), 1_000)
	telemetry = recordStreamDelta(
		telemetry,
		{ type: 'done', delta: 'ignored' },
		1_000,
	)
	telemetry = recordStreamDelta(telemetry, { type: 'text_delta' }, 1_000)

	assert.equal(telemetry.streamedCharacters, 64)
	assert.equal(estimatedOutputTokens(telemetry), 16)
	assert.equal(hasLiveEstimate(telemetry), true)
})

void test('exact usage replaces the streamed estimate and accumulates counts', () => {
	let telemetry = startTelemetry(0)
	telemetry = recordStreamDelta(telemetry, delta('text_delta', 400), 1_000)
	telemetry = recordStreamDelta(telemetry, delta('text_delta', 200), 2_000)
	telemetry = recordAssistantUsage(telemetry, assistantMessage(USAGE), 3_000)

	assert.equal(telemetry.streamedCharacters, 0)
	assert.equal(hasLiveEstimate(telemetry), false)
	assert.equal(estimatedOutputTokens(telemetry), 3_400)
	assert.equal(telemetry.inputTokens, 12_000)
	assert.equal(telemetry.cacheTokens, 8_100)
})

void test('messages without assistant usage leave telemetry untouched', () => {
	const streaming = recordStreamDelta(
		startTelemetry(0),
		delta('text_delta', 40),
		100,
	)
	const afterUser = recordAssistantUsage(streaming, { role: 'user' }, 200)
	const afterBare = recordAssistantUsage(
		streaming,
		assistantMessage(undefined),
		200,
	)

	assert.deepEqual(afterUser, streaming)
	assert.deepEqual(afterBare, streaming)
})

void test('a turn boundary drops the pending estimate', () => {
	const streaming = recordStreamDelta(
		startTelemetry(0),
		delta('text_delta', 400),
		1_000,
	)
	const nextTurn = startTurn(streaming, 5_000)

	assert.equal(nextTurn.streamedCharacters, 0)
	assert.equal(nextTurn.streamedMs, 4_000)
	assert.equal(nextTurn.streamStartedAtMs, 0)
})

void test('streamed time excludes waits between turns', () => {
	let telemetry = startTelemetry(0)
	// Turn 1 streams for two seconds, then reports usage; tool calls follow it.
	telemetry = recordStreamDelta(telemetry, { type: 'start' }, 1_000)
	telemetry = recordStreamDelta(telemetry, delta('text_delta', 4), 3_000)
	telemetry = recordAssistantUsage(telemetry, assistantMessage(USAGE), 3_000)
	assert.equal(streamedMs(telemetry, 30_000), 2_000)

	// Turn 2 opens a fresh window and is still streaming.
	telemetry = recordStreamDelta(telemetry, { type: 'start' }, 31_000)
	assert.equal(streamedMs(telemetry, 32_500), 3_500)
	assert.equal(streamedMs(telemetry, 30_000), 2_000)

	telemetry = recordAssistantUsage(telemetry, assistantMessage(USAGE), 36_000)
	assert.equal(streamedMs(telemetry, 60_000), 7_000)
})

void test('settling freezes the clock and closes the streaming window', () => {
	const streaming = recordStreamDelta(
		startTelemetry(1_000),
		delta('text_delta', 40),
		2_000,
	)
	const settled = settleTelemetry(streaming, 5_000)

	assert.equal(settled.settledAtMs, 5_000)
	assert.equal(elapsedMs(settled, 5_000), 4_000)
	assert.equal(elapsedMs(settled, 90_000), 4_000)
	assert.equal(streamedMs(settled, 90_000), 3_000)
	assert.equal(settled.streamedCharacters, 0)
})

void test('stopTelemetry drops the prompt from the line', () => {
	const stopped = stopTelemetry()
	assert.equal(stopped.active, false)
	assert.equal(elapsedMs(stopped, 90_000), 0)
})
