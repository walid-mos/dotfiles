import assert from 'node:assert/strict'
import test from 'node:test'

import { visibleWidth } from '@earendil-works/pi-tui'

import {
	formatElapsed,
	formatTokens,
	renderTelemetryBlock,
} from '../extensions/prompt-telemetry/render.ts'
import {
	recordAssistantUsage,
	recordStreamDelta,
	settleTelemetry,
	startTelemetry,
} from '../extensions/prompt-telemetry/state.ts'

import type { ActivityPaint } from '../extensions/prompt-telemetry/render.ts'
import type { PromptTelemetry } from '../extensions/prompt-telemetry/state.ts'

/** Identity paint: assertions read the text, widths stay terminal-real. */
const PAINT: ActivityPaint = {
	data: content => content,
	chrome: content => content,
	track: content => content,
}

/** Tagged paint: shows which tone each part of the block took. */
const TAGGED: ActivityPaint = {
	data: content => `<d>${content}</d>`,
	chrome: content => `<c>${content}</c>`,
	track: content => `<t>${content}</t>`,
}

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
	const line =
		renderTelemetryBlock(completedTelemetry(), 42_000, 120, PAINT) ?? ''

	assert.match(line, /00:42/u)
	assert.match(line, /12k input/u)
	assert.match(line, /3\.4k output/u)
	assert.match(line, /8\.1k cache/u)
	assert.match(line, /81 tok\/s/u)
	assert.doesNotMatch(line, /~/u)
})

void test('paints tally icons with the numbers and their words as chrome', () => {
	const telemetry = completedTelemetry()

	const words = renderTelemetryBlock(telemetry, 42_000, 100, TAGGED) ?? ''
	assert.match(
		words,
		/<d>\s*12k<\/d><c> input<\/c>/u,
		'words name the number they follow',
	)

	const icons = renderTelemetryBlock(telemetry, 42_000, 80, TAGGED) ?? ''
	assert.match(
		icons,
		/<d>\s*12k<\/d><d>↓<\/d>/u,
		'the icon rides with the number',
	)
	assert.match(icons, /<c>\/s<\/c>/u)
	assert.match(icons, /<c> · <\/c>/u, 'separators stay chrome')
})

void test('paints the settled check mark as data', () => {
	const settled = settleTelemetry(completedTelemetry(), 5_000)
	const line = renderTelemetryBlock(settled, 90_000, 120, TAGGED) ?? ''

	assert.match(line, /<d>✓<\/d>/u)
	assert.match(
		line,
		/<t>─+<\/t>/u,
		'the frozen track stays in the border hue',
	)
})

void test('marks the streamed estimate with a tilde', () => {
	let telemetry = startTelemetry(0)
	telemetry = recordStreamDelta(telemetry, { type: 'start' }, 1_000)
	telemetry = recordStreamDelta(telemetry, delta(400), 2_000)

	const line = renderTelemetryBlock(telemetry, 2_000, 120, PAINT) ?? ''

	assert.match(line, /~100 output/u)
	assert.match(line, /100 tok\/s/u)
})

void test('sweeps the readings columns while no token has arrived', () => {
	const waiting =
		renderTelemetryBlock(startTelemetry(0), 1_000, 120, PAINT) ?? ''
	const reported =
		renderTelemetryBlock(completedTelemetry(), 42_000, 120, PAINT) ?? ''

	assert.match(waiting, /━{3}/u, 'the head sweeps where the counts land')
	assert.match(
		waiting,
		/[━─] waiting for tokens$/u,
		'the wait runs up to its label, leaving no blank field',
	)
	assert.equal(
		visibleWidth(waiting),
		visibleWidth(reported),
		'the wait holds the width the counts report at',
	)
})

void test('freezes as a check clock with a flat track after settling', () => {
	const settled = settleTelemetry(completedTelemetry(), 5_000)
	const line = renderTelemetryBlock(settled, 90_000, 120, PAINT) ?? ''

	assert.match(line, /✓ 00:05/u)
	assert.doesNotMatch(line, /━/u)
})

void test('reports zeros when a prompt ends without reporting usage', () => {
	const settled = settleTelemetry(startTelemetry(0), 5_000)
	const line = renderTelemetryBlock(settled, 90_000, 120, PAINT) ?? ''

	assert.match(line, /✓ 00:05/u)
	assert.doesNotMatch(line, /waiting for tokens/u)
	assert.doesNotMatch(line, /━/u, 'the track is frozen flat')
	assert.match(line, /0 input/u)
})

void test('degrades counts before the clock as the block narrows', () => {
	const telemetry = completedTelemetry()

	const full = renderTelemetryBlock(telemetry, 42_000, 120, PAINT) ?? ''
	const compact = renderTelemetryBlock(telemetry, 42_000, 60, PAINT) ?? ''
	const minimal = renderTelemetryBlock(telemetry, 42_000, 50, PAINT) ?? ''
	const clockOnly = renderTelemetryBlock(telemetry, 42_000, 12, PAINT) ?? ''

	assert.match(full, /input/u)
	assert.doesNotMatch(full, /↓/u)
	assert.match(compact, /12k↓/u)
	assert.doesNotMatch(compact, / input/u)
	assert.match(minimal, /3\.4k tokens/u)
	assert.doesNotMatch(minimal, /input|↓/u)
	assert.match(clockOnly, /00:42/u)
	assert.doesNotMatch(clockOnly, /tokens/u)
})

void test('never renders wider than the budget it is given', () => {
	const telemetry = completedTelemetry()
	for (const width of [12, 20, 30, 40, 60, 80, 100, 120, 160]) {
		const block = renderTelemetryBlock(telemetry, 42_000, width, PAINT)
		if (!block) continue
		assert.ok(
			visibleWidth(block) <= width,
			`width ${String(width)} overflowed: ${block}`,
		)
	}
})

void test('keeps one width as counts grow, so a host never has to move it', () => {
	const budget = 120
	let streaming = startTelemetry(0)
	streaming = recordStreamDelta(streaming, { type: 'start' }, 1_000)
	streaming = recordStreamDelta(streaming, delta(400), 2_000)
	const states = [startTelemetry(0), streaming, completedTelemetry()]
	const blocks = states.map(
		telemetry =>
			renderTelemetryBlock(telemetry, 42_000, budget, PAINT) ?? '',
	)

	assert.match(blocks[0] ?? '', /waiting for tokens/u)
	assert.match(blocks[2] ?? '', /12k input/u)
	assert.equal(new Set(blocks.map(visibleWidth)).size, 1)
})

void test('has no block for a budget narrower than the clock', () => {
	const telemetry = completedTelemetry()

	assert.ok(!renderTelemetryBlock(telemetry, 42_000, 8, PAINT))
	assert.ok(renderTelemetryBlock(telemetry, 42_000, 9, PAINT))
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
