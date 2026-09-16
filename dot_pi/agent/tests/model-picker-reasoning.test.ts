/**
 * What the picker applies when the user commits a model, and what it leaves
 * alone: the reasoning level a row *displays* is the level the session gets -
 * a scope pattern's pin included - and nothing is applied when the switch
 * itself fails. Cancel applies nothing at all.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
	closeHarness,
	openPicker,
	pickerHarness,
	pickerModel,
} from './picker-harness-fixture.ts'
import { PICKER_KEYS } from './picker-keys-fixture.ts'

import type { PickerHarness } from './picker-harness-fixture.ts'

/** off/minimal/low/medium/high, the levels pi reports for a plain reasoner. */
const REASONING = pickerModel({
	provider: 'openrouter',
	id: 'union-alpha',
	reasoning: true,
})

/** off/high/max: a model that accepts the extended levels and skips the rest. */
const PINNED = pickerModel({
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

function harnessFor(options: {
	level: 'high' | 'max'
	scopedLevel?: 'high' | 'max' | 'xhigh'
	setModelFails?: boolean
}): PickerHarness {
	return pickerHarness({
		models: [REASONING, PINNED],
		current: REASONING,
		level: options.level,
		scoped: options.scopedLevel
			? [
					{ model: REASONING },
					{ model: PINNED, thinkingLevel: options.scopedLevel },
				]
			: [{ model: REASONING }, { model: PINNED }],
		...failingSwitch(options.setModelFails),
	})
}

function failingSwitch(
	doesFail: boolean | undefined,
): { setModelFails: true } | undefined {
	if (!doesFail) return undefined
	return { setModelFails: true }
}

/** Walk the cursor onto a row by reference, the way a user would. */
function selectRow(harness: PickerHarness, reference: string): void {
	for (let step = 0; step < 8; step += 1) {
		const line = harness
			.render(100)
			.find(row => row.includes('▸') && row.includes('/'))
		if (line?.includes(reference)) return
		harness.press(PICKER_KEYS.down)
	}
	throw new Error(`no row for ${reference}`)
}

test('enter applies the level the row shows when no arrow was pressed', async t => {
	const harness = harnessFor({ level: 'high' })
	t.after(() => closeHarness(harness))
	const { opened } = await openPicker(harness)

	harness.press(PICKER_KEYS.enter)
	await opened

	assert.deepEqual(harness.setModels, ['openrouter/union-alpha'])
	assert.deepEqual(harness.appliedLevels, ['high'])
})

test("a scope pattern's pinned level is applied on plain enter", async t => {
	const harness = harnessFor({ level: 'high', scopedLevel: 'max' })
	t.after(() => closeHarness(harness))
	const { opened } = await openPicker(harness)

	selectRow(harness, 'inco/glm-5.3-flash')
	harness.press(PICKER_KEYS.enter)
	await opened

	assert.deepEqual(harness.setModels, ['inco/glm-5.3-flash'])
	assert.deepEqual(harness.appliedLevels, ['max'])
})

test('the level is re-applied even when it matches the level the session ran', async t => {
	// A switch can clamp or re-derive the level, so equality with the old one
	// says nothing about what the new model ends up running.
	const harness = harnessFor({ level: 'max', scopedLevel: 'max' })
	t.after(() => closeHarness(harness))
	const { opened } = await openPicker(harness)

	selectRow(harness, 'inco/glm-5.3-flash')
	harness.press(PICKER_KEYS.enter)
	await opened

	assert.deepEqual(harness.appliedLevels, ['max'])
})

test('a failed model switch changes neither model nor reasoning level', async t => {
	const harness = harnessFor({ level: 'high', setModelFails: true })
	t.after(() => closeHarness(harness))
	const { opened } = await openPicker(harness)

	harness.press(PICKER_KEYS.right)
	harness.press(PICKER_KEYS.enter)
	await opened

	assert.deepEqual(harness.setModels, [])
	assert.deepEqual(harness.appliedLevels, [])
	assert.match(harness.notices.join('\n'), /no credentials configured/)
})

test('cancelling after a reasoning step applies nothing', async t => {
	const harness = harnessFor({ level: 'high' })
	t.after(() => closeHarness(harness))
	const { opened } = await openPicker(harness)

	harness.press(PICKER_KEYS.right)
	harness.press(PICKER_KEYS.escape)
	await opened

	assert.deepEqual(harness.setModels, [])
	assert.deepEqual(harness.appliedLevels, [])
})

test('a pin the model does not accept is shown as no choice and applies nothing', async t => {
	// `:xhigh` on a model whose levels stop at max: pi would clamp it, so the
	// row must not claim the session runs it.
	const harness = harnessFor({ level: 'high', scopedLevel: 'xhigh' })
	t.after(() => closeHarness(harness))
	const { opened } = await openPicker(harness)

	selectRow(harness, 'inco/glm-5.3-flash')
	assert.doesNotMatch(harness.render(100).join('\n'), /xhigh/)
	harness.press(PICKER_KEYS.enter)
	await opened

	assert.deepEqual(harness.setModels, ['inco/glm-5.3-flash'])
	assert.deepEqual(harness.appliedLevels, [])
})
