/**
 * The search field of the unified picker.
 *
 * The field is pi's own `Input`, so a pasted model id arrives whole, editing a
 * multi-byte character removes the whole character, and terminal control bytes
 * never reach the filter. The picker keeps left/right for the reasoning step,
 * which is why the field is fed the editing keys rather than owning them.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { stripTerminalSequences } from '@earendil-works/pi-tui'

import {
	closeHarness,
	openPicker,
	pickerHarness,
	pickerModel,
} from './picker-harness-fixture.ts'
import { PICKER_KEYS } from './picker-keys-fixture.ts'

import type { PickerHarness } from './picker-harness-fixture.ts'

const MODELS = [
	pickerModel({ provider: 'openrouter', id: 'union-alpha' }),
	pickerModel({ provider: 'inco', id: 'glm-5.3-flash' }),
	pickerModel({ provider: 'nebius', id: 'zai-org/GLM-5.3-Flash' }),
	pickerModel({ provider: 'deepseek', id: 'deepseek-v4-flash' }),
]

const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'

function harnessFor(t: test.TestContext): PickerHarness {
	const harness = pickerHarness({
		models: MODELS,
		current: MODELS[0],
		scoped: MODELS.map(model => ({ model })),
	})
	t.after(() => closeHarness(harness))
	return harness
}

/** The rows the frame shows, styled text removed. */
function rows(harness: PickerHarness): string[] {
	return harness
		.render(100)
		.filter(line => line.includes('/') && line.includes('▸'))
		.map(line => stripTerminalSequences(line))
}

/** The search row's text, styled text removed. */
function searchText(harness: PickerHarness): string {
	const found = harness
		.render(100)
		.map(line => stripTerminalSequences(line))
		.find(line => line.trimStart().startsWith('/'))
	assert.ok(found, 'expected the search row')
	return found.trimEnd()
}

test('a pasted model id filters the catalogue in one go', async t => {
	const harness = harnessFor(t)
	const { opened } = await openPicker(harness)

	harness.press(`${PASTE_START}zai-org/GLM-5.3-Flash${PASTE_END}`)
	const filtered = harness
		.render(100)
		.map(line => stripTerminalSequences(line))

	assert.ok(
		filtered.some(line => line.includes('nebius/zai-org/GLM-5.3-Flash')),
		'the pasted reference matches its row',
	)
	assert.equal(
		filtered.filter(line => line.includes('deepseek/deepseek-v4-flash'))
			.length,
		0,
		'the other models are filtered out',
	)

	harness.press(PICKER_KEYS.enter)
	await opened
	assert.deepEqual(harness.setModels, ['nebius/zai-org/GLM-5.3-Flash'])
})

test('backspace removes a whole multi-byte character', async t => {
	const harness = harnessFor(t)
	const { opened } = await openPicker(harness)

	harness.press(`${PASTE_START}glmé${PASTE_END}`)
	assert.match(searchText(harness), /\/ glmé/)

	harness.press(PICKER_KEYS.backspace)
	const trimmed = searchText(harness)
	assert.match(trimmed, /\/ glm /, 'the character is gone, not half-deleted')
	assert.equal(trimmed.includes('é'), false)

	harness.press(PICKER_KEYS.enter)
	await opened
	assert.deepEqual(harness.setModels, ['inco/glm-5.3-flash'])
})

test('terminal control sequences never reach the filter', async t => {
	const harness = harnessFor(t)
	const { opened } = await openPicker(harness)

	// A colour escape and a raw bell: neither is text a user typed.
	harness.press('\x1b[31m')
	harness.press('\x07')

	const rendered = harness
		.render(100)
		.map(line => stripTerminalSequences(line))
	assert.equal(
		rendered.filter(line => line.includes('[31m')).length,
		0,
		'the escape sequence stays out of the frame',
	)
	assert.deepEqual(
		rows(harness).length,
		1,
		'the catalogue is unfiltered: nothing was inserted',
	)

	harness.press(PICKER_KEYS.escape)
	await opened
})

test('left and right still step the reasoning level while the field has text', async t => {
	const harness = pickerHarness({
		models: [
			pickerModel({
				provider: 'inco',
				id: 'glm-5.3-flash',
				reasoning: true,
				thinkingLevelMap: { xhigh: null },
			}),
		],
		current: MODELS[1],
		level: 'low',
	})
	t.after(() => closeHarness(harness))
	const { opened } = await openPicker(harness)

	harness.press(`${PASTE_START}glm${PASTE_END}`)
	harness.press(PICKER_KEYS.right)
	harness.press(PICKER_KEYS.enter)
	await opened

	assert.deepEqual(harness.setModels, ['inco/glm-5.3-flash'])
	assert.deepEqual(harness.appliedLevels, ['medium'])
})
