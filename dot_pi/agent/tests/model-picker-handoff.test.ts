/**
 * The per-agent handoff of the unified model picker.
 *
 * The picker never edits a subagent's own configuration: that belongs to the
 * `subagents` package. What it owns is the handoff - the user asks for
 * per-agent models, the picker releases its own modal, and only then does the
 * `subagents` command run. Dispatching while the picker still holds the screen
 * (or reopening it afterwards) is what made the old menu look dead.
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

const SESSION_MODEL = pickerModel({ provider: 'openrouter', id: 'union-alpha' })
const OTHER_MODEL = pickerModel({ provider: 'inco', id: 'glm-5.3-flash' })

const PICKED_AGENTS = {
	enabledModels: ['openrouter/union-alpha'],
	subagents: { agentOverrides: { scout: { model: 'inco/glm-5.3-flash' } } },
}

/** Session -> scope -> fallbacks -> agents, then onto the subagents action row. */
function toOpenAgentsRow(harness: {
	press: (key: string) => void
	render: (width: number, height?: number) => string[]
}): void {
	for (let step = 0; step < 3; step += 1) harness.press(PICKER_KEYS.tab)
	for (let step = 0; step < 10; step += 1) {
		const selected = harness
			.render(100)
			.find(line => line.includes('▸') && line.includes('/'))
		if (selected?.includes('open per-agent models')) return
		harness.press(PICKER_KEYS.down)
	}
	throw new Error('no open per-agent models row')
}

test('the per-agent action dispatches /subagents only after the picker released its modal', async t => {
	const harness = pickerHarness({
		commands: ['subagents'],
		models: [SESSION_MODEL, OTHER_MODEL],
		current: SESSION_MODEL,
		settings: PICKED_AGENTS,
	})
	t.after(() => closeHarness(harness))
	const { opened } = await openPicker(harness)

	toOpenAgentsRow(harness)
	harness.press(PICKER_KEYS.enter)
	await opened

	assert.deepEqual(harness.dispatches, [
		{
			content: '/subagents',
			expandPromptTemplates: true,
			hadOpenModal: false,
		},
	])
	assert.deepEqual(harness.modalsOpened, ['custom'])
})

test('the per-agent action reports a missing subagents package instead of dispatching', async t => {
	const harness = pickerHarness({
		models: [SESSION_MODEL, OTHER_MODEL],
		current: SESSION_MODEL,
		settings: PICKED_AGENTS,
	})
	t.after(() => closeHarness(harness))
	const { opened } = await openPicker(harness)

	toOpenAgentsRow(harness)
	harness.press(PICKER_KEYS.enter)
	await opened

	assert.deepEqual(harness.dispatches, [])
	assert.match(harness.notices.join('\n'), /subagents package is not loaded/)
})
