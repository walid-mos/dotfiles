/**
 * How the picker hands a user off to the surfaces that own model state.
 *
 * Per-agent models belong to the `subagents` command and the model scope
 * belongs to pi's built-in `/scoped-models` selector. Both handoffs happen
 * after the picker has released the editor, both are reachable by clicking the
 * row a user is aiming at, and neither ever sends a built-in command as a
 * prompt (pi would ask the model about it instead of opening the selector).
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

const SESSION = pickerModel({ provider: 'openrouter', id: 'union-alpha' })
const OTHER = pickerModel({ provider: 'inco', id: 'glm-5.3-flash' })

function agentsHarness(t: test.TestContext): PickerHarness {
	const harness = pickerHarness({
		commands: ['subagents'],
		models: [SESSION, OTHER],
		current: SESSION,
		scoped: [{ model: SESSION }, { model: OTHER }],
	})
	t.after(() => closeHarness(harness))
	return harness
}

function scopeHarness(t: test.TestContext): PickerHarness {
	const harness = pickerHarness({
		models: [SESSION, OTHER],
		current: SESSION,
		scoped: [{ model: SESSION }, { model: OTHER }],
	})
	t.after(() => closeHarness(harness))
	return harness
}

/** The line index of a row, as a click would carry it. */
function lineOf(harness: PickerHarness, text: string): number {
	const index = harness
		.render(100)
		.findIndex(line => stripTerminalSequences(line).includes(text))
	assert.notEqual(index, -1, `no rendered line for ${text}`)
	return index
}

test('a left click on the per-agent row opens the subagents surface', async t => {
	const harness = agentsHarness(t)
	const { opened } = await openPicker(harness)

	harness.press(PICKER_KEYS.tab)
	harness.press(PICKER_KEYS.tab)
	harness.press(PICKER_KEYS.tab)
	harness.mouse({
		type: 'click',
		lineIndex: lineOf(harness, 'open per-agent models'),
	})
	await opened

	assert.deepEqual(harness.dispatches, [
		{
			content: '/subagents',
			expandPromptTemplates: true,
			hadOpenModal: false,
		},
	])
})

test('a right click or a drag on the per-agent row opens nothing', async t => {
	const harness = agentsHarness(t)
	const { opened } = await openPicker(harness)

	harness.press(PICKER_KEYS.tab)
	harness.press(PICKER_KEYS.tab)
	harness.press(PICKER_KEYS.tab)
	const row = lineOf(harness, 'open per-agent models')
	harness.mouse({ type: 'click', button: 'right', lineIndex: row })
	harness.mouse({ type: 'drag', lineIndex: row })
	harness.mouse({ type: 'press', lineIndex: row })
	harness.press(PICKER_KEYS.escape)
	await opened

	assert.deepEqual(harness.dispatches, [])
})

test('a click on a model row only moves the cursor', async t => {
	const harness = agentsHarness(t)
	const { opened } = await openPicker(harness)

	const row = lineOf(harness, 'inco/glm-5.3-flash')
	harness.mouse({ type: 'click', lineIndex: row })
	assert.deepEqual(
		harness.setModels,
		[],
		'a click must not switch the session model by itself',
	)

	harness.press(PICKER_KEYS.enter)
	await opened
	assert.deepEqual(harness.setModels, ['inco/glm-5.3-flash'])
})

test('the scope tab names the native selector it cannot open', async t => {
	// `/scoped-models` is a built-in interactive command: `getCommands` does not
	// list it, sending it as a prompt would ask the model about it, and a
	// prefilled editor does not execute it (verified in a real pi instance).
	// The tab states the command instead of pretending to open the selector.
	const harness = scopeHarness(t)
	const { opened } = await openPicker(harness)

	harness.press(PICKER_KEYS.tab)
	const rendered = stripTerminalSequences(harness.render(100).join('\n'))

	assert.match(rendered, /type \/scoped-models/)
	assert.match(rendered, /ctrl\+s there saves it/)
	assert.deepEqual(harness.dispatches, [])

	harness.press(PICKER_KEYS.escape)
	await opened
})

test('scope rows and clicks change nothing', async t => {
	const harness = scopeHarness(t)
	const { opened } = await openPicker(harness)

	harness.press(PICKER_KEYS.tab)
	harness.mouse({
		type: 'click',
		lineIndex: lineOf(harness, 'openrouter/union-alpha'),
	})
	harness.press(PICKER_KEYS.enter)
	harness.press(PICKER_KEYS.down)
	harness.press(PICKER_KEYS.enter)

	assert.deepEqual(harness.setModels, [], 'the scope tab is a report')
	assert.deepEqual(harness.savedConfigs, [])
	harness.press(PICKER_KEYS.escape)
	await opened
})
