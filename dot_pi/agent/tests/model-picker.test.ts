/**
 * The session tab of the unified model picker, at the seams a user touches:
 * search, the model choice, the reasoning level, cancel, and the price
 * reading. Every case drives the mounted component with the bytes a terminal
 * sends and asserts on what crossed a pi seam or on the rendered frame.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui'

import { createOpenRouterPricingSource } from '../extensions/model-fallback/openrouter-pricing.ts'

import { openRouterFixtureFetch } from './openrouter-models-fixture.ts'
import {
	closeHarness,
	openPicker,
	pickerHarness,
	pickerModel,
} from './picker-harness-fixture.ts'
import { PICKER_KEYS } from './picker-keys-fixture.ts'

import type { OpenRouterPricingSource } from '../extensions/model-fallback/openrouter-pricing.ts'
import type { HarnessOptions, PickerHarness } from './picker-harness-fixture.ts'

const MAX_ROW_STEPS = 30
/** The levels pi reports for THINKING: off, plus high and max. */
const MODEL_LEVELS = ['off', 'high', 'max']

const CHEAP = pickerModel({
	provider: 'deepseek',
	id: 'deepseek-v4-flash',
	cost: { input: 0.3, output: 1.2, cacheRead: 0.1, cacheWrite: 0.4 },
})

/** Reasoning with holes: pi reports off/high/max for a model like this. */
const THINKING = pickerModel({
	provider: 'inco',
	id: 'glm-5.3-flash',
	reasoning: true,
	thinkingLevelMap: {
		minimal: null,
		low: null,
		medium: null,
		xhigh: null,
		high: 'high',
		max: 'max',
	},
})

const PRICEY = pickerModel({
	provider: 'openrouter',
	id: 'steer/expensive',
	cost: { input: 12, output: 45, cacheRead: 3, cacheWrite: 12 },
})

const UNPRICED = pickerModel({
	provider: 'openai-codex',
	id: 'gpt-6-astra',
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
})

/** The captured live zero-cost model: the catalog carries it at all zeros. */
const UNION_ALPHA = pickerModel({
	provider: 'openrouter',
	id: 'stealth/union-alpha',
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
})

/** A captured paid entry: per-token prices that must land as per-million. */
const LIVE_PRICED = pickerModel({
	provider: 'openrouter',
	id: 'qwen/qwen3.8-flash',
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
})

/** A captured dynamic-price entry: OpenRouter publishes -1, not a rate. */
const AUTO_ROUTER = pickerModel({
	provider: 'openrouter',
	id: 'openrouter/auto',
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
})

/** The captured public list behind the production adapter, no live network. */
function livePricing(): OpenRouterPricingSource {
	return createOpenRouterPricingSource(openRouterFixtureFetch())
}

function session(overrides: HarnessOptions = {}): PickerHarness {
	return pickerHarness({
		models: [CHEAP, THINKING, PRICEY],
		current: CHEAP,
		level: 'low',
		...overrides,
	})
}

async function openSession(
	t: test.TestContext,
	overrides: HarnessOptions = {},
): Promise<{ harness: PickerHarness; opened: Promise<void> }> {
	const harness = session(overrides)
	t.after(() => closeHarness(harness))
	const { opened } = await openPicker(harness)
	return { harness, opened }
}

/** The row under the cursor: the one line carrying both marker and reference. */
function selectedRow(harness: PickerHarness): string {
	const line = harness
		.render(100)
		.find(row => row.includes('▸') && row.includes('/'))
	assert.ok(line, 'expected a selected row in the frame')
	return line
}

/** Walk the cursor onto a row by reference, the way a user would. */
function selectRow(harness: PickerHarness, reference: string): void {
	for (let step = 0; step < MAX_ROW_STEPS; step += 1) {
		if (selectedRow(harness).includes(reference)) return
		harness.press(PICKER_KEYS.down)
	}
	throw new Error(`no row for ${reference}`)
}

test('enter switches the session model to the row under the cursor', async t => {
	const { harness, opened } = await openSession(t)

	selectRow(harness, 'inco/glm-5.3-flash')
	harness.press(PICKER_KEYS.enter)
	await opened

	assert.deepEqual(harness.setModels, ['inco/glm-5.3-flash'])
	assert.deepEqual(harness.appliedLevels, [])
})

test('the reasoning step visits only the levels pi reports for that model', async t => {
	const { harness, opened } = await openSession(t)

	selectRow(harness, 'inco/glm-5.3-flash')
	const visited = new Set<string>()
	for (let step = 0; step < 7; step += 1) {
		harness.press(PICKER_KEYS.right)
		const row = stripTerminalSequences(selectedRow(harness))
		const level = MODEL_LEVELS.find(name => row.includes(name))
		assert.ok(level, `no level pi reports in the row: ${row}`)
		visited.add(level)
	}
	assert.deepEqual(
		[...visited].toSorted(),
		['high', 'max', 'off'],
		'the session runs "low", which this model does not accept',
	)

	harness.press(PICKER_KEYS.enter)
	await opened
	assert.equal(harness.appliedLevels.length, 1)
	assert.ok(MODEL_LEVELS.includes(harness.appliedLevels[0] ?? ''))
})

test('a reasoning step is pending until enter and escape discards it', async t => {
	const { harness, opened } = await openSession(t)

	selectRow(harness, 'inco/glm-5.3-flash')
	harness.press(PICKER_KEYS.right)
	harness.press(PICKER_KEYS.right)
	harness.press(PICKER_KEYS.escape)
	await opened

	assert.deepEqual(harness.setModels, [])
	assert.deepEqual(harness.appliedLevels, [])
	assert.deepEqual(harness.savedConfigs, [])
	assert.deepEqual(harness.modalsOpened, ['custom'])
})

test('cancelling leaves the session model where it was', async t => {
	const { harness, opened } = await openSession(t)

	harness.press(PICKER_KEYS.down)
	harness.press(PICKER_KEYS.escape)
	await opened

	assert.deepEqual(harness.setModels, [])
	assert.deepEqual(harness.notices, [])
})

test('the search narrows the catalogue and enter picks the filtered row', async t => {
	const { harness, opened } = await openSession(t)

	for (const key of 'steer') harness.press(key)
	harness.press(PICKER_KEYS.backspace)
	harness.press(PICKER_KEYS.enter)
	await opened

	assert.deepEqual(harness.setModels, ['openrouter/steer/expensive'])
})

test('the price columns report the catalog rates per million tokens', async t => {
	const { harness } = await openSession(t)

	const frame = harness.render(100).join('\n')

	assert.match(frame, /Input \$0\.30/)
	assert.match(frame, /Cached input \$0\.10/)
	assert.match(frame, /Output \$1\.20/)
	assert.match(frame, /per 1M tokens/)
})

test('an unpriced model is reported as unpriced, never as free', async t => {
	const { harness } = await openSession(t, {
		models: [UNPRICED],
		current: UNPRICED,
	})

	const frame = harness.render(100).join('\n')

	assert.match(frame, /no catalog price/)
	assert.match(frame, /not proof of a free request/)
	assert.match(frame, /Input - · Cached input - · Output -/)
})

test('the gauge discloses its formula and marks the dearer model further right', async t => {
	const { harness } = await openSession(t)

	const gaugeLine = (): string => {
		const line = harness.render(100).find(row => row.includes('◉'))
		assert.ok(line, 'expected the cursor model marker on the gauge')
		return line
	}
	const cheapLine = gaugeLine()
	selectRow(harness, 'openrouter/steer/expensive')
	const dearLine = gaugeLine()

	assert.ok(
		dearLine.indexOf('◉') > cheapLine.indexOf('◉'),
		'a dearer model must sit further right on the gauge',
	)
	assert.match(
		harness.render(100).join('\n'),
		/gauge · blend \(input \+ cached \+ output\) \/ 3 per 1M tokens, log scale \$0\.01 - \$50/,
	)
})

test('a left click moves the cursor onto the clicked row', async t => {
	const { harness, opened } = await openSession(t)

	const lines = harness.render(100)
	const clicked = lines.findIndex(line =>
		line.includes('openrouter/steer/expensive'),
	)
	assert.notEqual(clicked, -1, 'expected the row to be on screen')
	harness.mouse({ type: 'click', lineIndex: clicked })
	harness.press(PICKER_KEYS.enter)
	await opened

	assert.deepEqual(harness.setModels, ['openrouter/steer/expensive'])
})

test('a right click and a click on chrome leave the cursor where it is', async t => {
	const { harness, opened } = await openSession(t)

	harness.mouse({ type: 'click', button: 'right', lineIndex: 5 })
	harness.mouse({ type: 'click', lineIndex: 0 })
	harness.press(PICKER_KEYS.enter)
	await opened

	assert.deepEqual(harness.setModels, ['deepseek/deepseek-v4-flash'])
})

test('the gauge marks the cursor model solid and the session model hollow', async t => {
	const { harness } = await openSession(t)

	selectRow(harness, 'openrouter/steer/expensive')
	const gauge = stripTerminalSequences(
		harness.render(100).find(row => row.includes('◉')) ?? '',
	)

	assert.match(gauge, /○.*◉/, 'session marker left of the cursor marker')
})

test('every rendered line fits the terminal width', async t => {
	const { harness } = await openSession(t)

	for (const width of [120, 80, 56, 40, 24]) {
		const lines = harness.render(width, 24)
		assert.ok(lines.length > 0, `no frame at width ${width}`)
		for (const line of lines)
			assert.ok(
				visibleWidth(line) <= width,
				`width ${width} overrun: ${JSON.stringify(line)}`,
			)
	}
})

test('a narrow terminal drops the gauge instead of overflowing', async t => {
	const { harness } = await openSession(t)

	const wide = harness.render(100).join('\n')
	const narrow = harness.render(40).join('\n')

	assert.match(wide, /gauge · /)
	assert.doesNotMatch(narrow, /gauge · /)
	assert.match(narrow, /Input \$0\.30/)
})

test('a live zero-cost model reads Free with $0 rates at the free end of the gauge', async t => {
	const { harness } = await openSession(t, {
		models: [UNION_ALPHA],
		current: UNION_ALPHA,
		pricing: livePricing(),
	})

	const frame = stripTerminalSequences(harness.render(120).join('\n'))

	assert.match(frame, /openrouter\/stealth\/union-alpha/)
	assert.match(frame, /Free - every price OpenRouter publishes is \$0\.00/)
	assert.match(frame, /Input \$0\.00/)
	assert.match(frame, /Cached input -/)
	assert.match(frame, /Output \$0\.00/)
	assert.doesNotMatch(frame, /no catalog price/)
	const gaugeRow = frame.split('\n').find(row => row.includes('◉'))
	assert.ok(gaugeRow)
	assert.match(
		gaugeRow,
		/^ {2}◉─/,
		'the $0 model sits at the left end of the track',
	)
	assert.match(
		frame,
		/blend \(input \+ output\) \/ 2/,
		'only the published rates are blended',
	)
})

test('live per-token prices print as per-million rate columns', async t => {
	const { harness } = await openSession(t, {
		models: [LIVE_PRICED],
		current: LIVE_PRICED,
		pricing: livePricing(),
	})

	const frame = stripTerminalSequences(harness.render(120).join('\n'))

	assert.match(frame, /Input \$0\.15/)
	assert.match(frame, /Cached input \$0\.02/)
	assert.match(frame, /Output \$0\.47/)
	assert.match(frame, /live OpenRouter rates \(fetched just now\)/)
	assert.doesNotMatch(frame, /Free -/)
})

test('an unread live list leaves a zero-cost row unpriced, never free', async t => {
	const { harness } = await openSession(t, {
		models: [UNION_ALPHA],
		current: UNION_ALPHA,
	})

	const frame = stripTerminalSequences(harness.render(120).join('\n'))

	assert.match(frame, /no live OpenRouter price and no catalog price/)
	assert.match(frame, /Input - · Cached input - · Output -/)
	assert.doesNotMatch(frame, /Free -/)
})

test('a live dynamic-price row stays unknown, never free from its zero catalog cost', async t => {
	const { harness } = await openSession(t, {
		models: [AUTO_ROUTER],
		current: AUTO_ROUTER,
		pricing: livePricing(),
	})

	const frame = stripTerminalSequences(harness.render(120).join('\n'))

	assert.match(frame, /no live OpenRouter price and no catalog price/)
	assert.doesNotMatch(frame, /Free -/)
})

test('the live list prices only the rows it names', async t => {
	const { harness } = await openSession(t, {
		models: [CHEAP, UNION_ALPHA],
		current: CHEAP,
		pricing: livePricing(),
	})

	const frame = stripTerminalSequences(harness.render(120).join('\n'))
	assert.match(frame, /Input \$0\.30/)
	assert.match(frame, /catalog rates/)
	assert.doesNotMatch(frame, /live OpenRouter rates/)

	selectRow(harness, 'openrouter/stealth/union-alpha')
	const liveFrame = stripTerminalSequences(harness.render(120).join('\n'))
	assert.match(
		liveFrame,
		/Free - every price OpenRouter publishes is \$0\.00/,
	)
})
