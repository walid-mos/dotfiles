/**
 * The escape contract of the unified picker: one level back at a time.
 *
 * A search draft clears first, an open editor closes back to the tab it came
 * from, a row action the user just committed is released, and only a plain tab
 * closes the picker - so escape right after acting on a row returns to where
 * the user was instead of quitting the widget. The footer states which of
 * those the next escape is.
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
const ALPHA = pickerModel({ provider: 'inco', id: 'glm-5.3-flash' })

const PINNED_AGENTS = {
	subagents: {
		agentOverrides: { researcher: { model: 'inco/glm-5.3-flash' } },
	},
}

function escapeHarness(t: test.TestContext): PickerHarness {
	const harness = pickerHarness({
		commands: ['subagents'],
		models: [SESSION, ALPHA],
		current: SESSION,
		scoped: [SESSION, ALPHA].map(model => ({ model })),
		settings: PINNED_AGENTS,
	})
	t.after(() => closeHarness(harness))
	return harness
}

/** The frame with its styling removed: assertions read text, not ANSI codes. */
function frame(harness: PickerHarness): string {
	return stripTerminalSequences(harness.render(100).join('\n'))
}

/** What the footer tells the user escape will do next. */
function escapeHint(harness: PickerHarness): string {
	const hint = harness
		.render(100)
		.map(line => stripTerminalSequences(line))
		.find(line => line.includes('esc '))
	assert.ok(hint, 'expected the footer hint')
	return hint
}

/** The search row's text, styled text removed. */
function searchText(harness: PickerHarness): string {
	const found = harness
		.render(100)
		.map(line => stripTerminalSequences(line))
		.find(line => line.trimStart().startsWith('/'))
	assert.ok(found, 'expected a search row')
	return found.trimEnd()
}

/** Walk the cursor onto a row by the text that row shows. */
function selectRow(harness: PickerHarness, text: string): void {
	for (let step = 0; step < 12; step += 1) {
		const selected = harness
			.render(100)
			.map(line => stripTerminalSequences(line))
			.find(row => /^\s+▸/.test(row))
		if (selected?.includes(text)) return
		harness.press(PICKER_KEYS.down)
	}
	throw new Error(`no row for ${text}`)
}

test('escape clears an active search before it closes the picker', async t => {
	const harness = escapeHarness(t)
	const { opened } = await openPicker(harness)

	for (const key of 'glm') harness.press(key)
	assert.match(searchText(harness), /\/ glm/)
	assert.match(escapeHint(harness), /esc clear search/)

	harness.press(PICKER_KEYS.escape)
	assert.match(
		searchText(harness),
		/Type to search/,
		'still open, list restored',
	)
	assert.match(escapeHint(harness), /esc close/)

	harness.press(PICKER_KEYS.escape)
	await opened
})

test('escape after a fallbacks row action backs out to the list before closing', async t => {
	const harness = escapeHarness(t)
	const { opened } = await openPicker(harness)
	harness.press(PICKER_KEYS.tab)
	harness.press(PICKER_KEYS.tab)
	selectRow(harness, 'auto-fallback on provider failure')

	harness.press(PICKER_KEYS.enter)
	const saved = harness.savedConfigs.length
	assert.equal(harness.savedConfigs.at(-1)?.autoFallback, false)
	assert.match(escapeHint(harness), /esc back/)

	// The first escape returns to the list the user was on - it must not quit
	// the widget, and it must not undo or re-save anything either.
	harness.press(PICKER_KEYS.escape)
	assert.match(frame(harness), /fallbacks/)
	assert.match(escapeHint(harness), /esc close/)
	assert.equal(harness.savedConfigs.length, saved)

	harness.press(PICKER_KEYS.escape)
	await opened
})

test('escape after adding a chain model backs out to the list before closing', async t => {
	const harness = escapeHarness(t)
	const { opened } = await openPicker(harness)
	harness.press(PICKER_KEYS.tab)
	harness.press(PICKER_KEYS.tab)
	selectRow(harness, '+ inco/glm-5.3-flash')

	harness.press(PICKER_KEYS.enter)
	assert.deepEqual(harness.savedConfigs.at(-1)?.chain, ['inco/glm-5.3-flash'])

	harness.press(PICKER_KEYS.escape)
	assert.match(escapeHint(harness), /esc close/, 'the action is released')
	harness.press(PICKER_KEYS.escape)
	await opened
})

test('escape backs out of the agent editor to the agents tab, then closes', async t => {
	const harness = escapeHarness(t)
	const { opened } = await openPicker(harness)
	for (let step = 0; step < 3; step += 1) harness.press(PICKER_KEYS.tab)
	selectRow(harness, 'researcher')

	harness.press(PICKER_KEYS.enter)
	assert.match(frame(harness), /editing researcher/)
	assert.match(escapeHint(harness), /esc back/)

	harness.press(PICKER_KEYS.escape)
	assert.equal(frame(harness).includes('editing researcher'), false)
	assert.match(frame(harness), /open per-agent models/)
	assert.match(escapeHint(harness), /esc close/)

	harness.press(PICKER_KEYS.escape)
	await opened
})

test('escape at a session root cancels with nothing applied', async t => {
	const harness = escapeHarness(t)
	const { opened } = await openPicker(harness)

	assert.match(escapeHint(harness), /esc close/)
	harness.press(PICKER_KEYS.right)
	harness.press(PICKER_KEYS.escape)
	await opened

	assert.deepEqual(harness.setModels, [])
	assert.deepEqual(harness.appliedLevels, [])
})

test('escaping a search never discards a pending model choice', async t => {
	const harness = escapeHarness(t)
	const { opened } = await openPicker(harness)

	harness.press(PICKER_KEYS.right)
	for (const key of 'glm') harness.press(key)
	harness.press(PICKER_KEYS.escape)
	assert.match(
		searchText(harness),
		/Type to search/,
		'the choice is still pending',
	)

	// The pending level is still discarded by the escape that cancels.
	harness.press(PICKER_KEYS.escape)
	await opened
	assert.deepEqual(harness.appliedLevels, [])
})
