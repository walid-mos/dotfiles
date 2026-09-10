import assert from 'node:assert/strict'
import test from 'node:test'

import { visibleWidth } from '@earendil-works/pi-tui'

import {
	formatElapsed,
	formatTokens,
	renderTelemetryLine,
} from '../extensions/prompt-telemetry/render.ts'
import {
	recordAssistantUsage,
	recordStreamDelta,
	settleTelemetry,
	startTelemetry,
} from '../extensions/prompt-telemetry/state.ts'

import type { Theme } from '@earendil-works/pi-coding-agent'
import type { PromptTelemetry } from '../extensions/prompt-telemetry/state.ts'

/** Identity theme: assertions read the text, widths stay terminal-real. */
// oxlint-disable-next-line nextnode/no-type-assertion typescript/no-unsafe-type-assertion
const THEME = {
	fg: (_color: string, content: string) => content,
} as Theme

const USAGE = {
	input: 12_000,
	output: 3_400,
	cacheRead: 7_000,
	cacheWrite: 1_100,
}

function delta(length: number): { type: string; delta: string } {
	return { type: 'text_delta', delta: 'x'.repeat(length) }
}

/** One prompt that streamed for 42 s and then reported exact usage. */
function completedTelemetry(): PromptTelemetry {
	let telemetry = startTelemetry(0)
	telemetry = recordStreamDelta(telemetry, { type: 'start' }, 1_000)
	telemetry = recordStreamDelta(telemetry, delta(400), 2_000)
	return recordAssistantUsage(
		telemetry,
		{ role: 'assistant', usage: USAGE },
		43_000,
	)
}

void test('shows clock, prompt tokens and rate once usage is exact', () => {
	const line = renderTelemetryLine(completedTelemetry(), 42_000, 120, THEME)

	assert.match(line, /00:42/u)
	assert.match(line, /12k input/u)
	assert.match(line, /3\.4k output/u)
	assert.match(line, /8\.1k cache/u)
	assert.match(line, /81 tok\/s/u)
	assert.doesNotMatch(line, /~/u)
})

void test('marks the streamed estimate with a tilde', () => {
	let telemetry = startTelemetry(0)
	telemetry = recordStreamDelta(telemetry, { type: 'start' }, 1_000)
	telemetry = recordStreamDelta(telemetry, delta(400), 2_000)

	const line = renderTelemetryLine(telemetry, 2_000, 120, THEME)

	assert.match(line, /~100 output/u)
	assert.match(line, /100 tok\/s/u)
})

void test('waits for tokens before the first count', () => {
	const line = renderTelemetryLine(startTelemetry(0), 1_000, 120, THEME)

	assert.match(line, /waiting for tokens/u)
})

void test('freezes as a check clock with a flat track after settling', () => {
	const settled = settleTelemetry(completedTelemetry(), 5_000)
	const line = renderTelemetryLine(settled, 90_000, 120, THEME)

	assert.match(line, /✓ 00:05/u)
	assert.doesNotMatch(line, /━/u)
})

void test('degrades counts before the clock as the line narrows', () => {
	const telemetry = completedTelemetry()

	const full = renderTelemetryLine(telemetry, 42_000, 120, THEME)
	const compact = renderTelemetryLine(telemetry, 42_000, 60, THEME)
	const minimal = renderTelemetryLine(telemetry, 42_000, 40, THEME)
	const clockOnly = renderTelemetryLine(telemetry, 42_000, 12, THEME)

	assert.match(full, /input/u)
	assert.doesNotMatch(full, /↓/u)
	assert.match(compact, /12k↓/u)
	assert.doesNotMatch(compact, / input/u)
	assert.match(minimal, /3\.4k tokens/u)
	assert.doesNotMatch(minimal, /input|↓/u)
	assert.match(clockOnly, /00:42/u)
	assert.doesNotMatch(clockOnly, /tokens/u)
})

void test('never renders wider than the terminal it is given', () => {
	const telemetry = completedTelemetry()
	for (const width of [12, 20, 30, 40, 60, 80, 100, 120, 160]) {
		const line = renderTelemetryLine(telemetry, 42_000, width, THEME)
		assert.ok(
			visibleWidth(line) <= width,
			`width ${String(width)} overflowed: ${line}`,
		)
	}
})

void test('formats elapsed time as zero-padded minutes and seconds', () => {
	assert.equal(formatElapsed(0), '00:00')
	assert.equal(formatElapsed(59_999), '00:59')
	assert.equal(formatElapsed(60_000), '01:00')
	assert.equal(formatElapsed(3_599_999), '59:59')
})

void test('compacts token counts at thousand and million boundaries', () => {
	assert.equal(formatTokens(0), '0')
	assert.equal(formatTokens(999), '999')
	assert.equal(formatTokens(1_000), '1.0k')
	assert.equal(formatTokens(12_400), '12k')
	assert.equal(formatTokens(999_999), '1.0M')
	assert.equal(formatTokens(2_500_000), '2.5M')
})
