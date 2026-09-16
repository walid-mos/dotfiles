/**
 * The fallback, scope and agent tabs of the unified picker.
 *
 * The chain is the failover order, so its editing contract is exact: alt+up and
 * alt+down move one entry, the ends are hard stops, a model joins once, and
 * every edit is persisted as it is made because the file is what the next
 * session reads. The scope and agent tabs only report what other owners
 * configured: driving them must leave the settings file byte-identical.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { stripTerminalSequences } from '@earendil-works/pi-tui'

import { defaultConfig } from '../extensions/model-fallback/config.ts'

import {
	closeHarness,
	openPicker,
	pickerHarness,
	pickerModel,
	settingsText,
} from './picker-harness-fixture.ts'
import { PICKER_KEYS } from './picker-keys-fixture.ts'

import type { Api, Model } from '@earendil-works/pi-ai'
import type { PickerHarness } from './picker-harness-fixture.ts'

const ALPHA = pickerModel({ provider: 'inco', id: 'glm-5.3-flash' })
const BETA = pickerModel({ provider: 'openrouter', id: 'z-ai/glm-5.3-flash' })
const GAMMA = pickerModel({ provider: 'deepseek', id: 'deepseek-v4-flash' })
const SESSION = pickerModel({ provider: 'openrouter', id: 'union-alpha' })

const SETTINGS = {
	enabledModels: ['inco/glm-5.3-flash', 'openrouter/union-alpha'],
	subagents: {
		agentOverrides: {
			scout: { model: 'inco/glm-5.3-flash:fast', thinking: 'low' },
			researcher: { model: 'inco/glm-5.3-flash', thinking: 'high' },
		},
	},
}

/** The frame with its styling removed: assertions read text, not ANSI codes. */
function frame(harness: PickerHarness, height = 40): string {
	return stripTerminalSequences(harness.render(100, height).join('\n'))
}

/** The scope tab of a session whose scope the settings file does not explain. */
function scopedHarness(
	t: test.TestContext,
	options: {
		scoped: readonly Model<Api>[]
		settings?: unknown
		writeSettings?: boolean
	},
): PickerHarness {
	const harness = pickerHarness({
		models: [SESSION, ALPHA, BETA, GAMMA],
		current: SESSION,
		scoped: options.scoped.map(model => ({ model })),
		settings: options.settings ?? {},
		writeSettings: options.writeSettings ?? true,
	})
	t.after(() => closeHarness(harness))
	return harness
}

function chainHarness(t: test.TestContext): PickerHarness {
	const harness = pickerHarness({
		models: [SESSION, ALPHA, BETA, GAMMA],
		current: SESSION,
		settings: SETTINGS,
		scoped: [SESSION, ALPHA, BETA, GAMMA].map(model => ({ model })),
		config: {
			...defaultConfig(),
			chain: [ALPHA, BETA].map(model => `${model.provider}/${model.id}`),
		},
	})
	t.after(() => closeHarness(harness))
	return harness
}

/**
 * Press down until the selected row shows `text`. The chain and its candidates
 * come first in the list, the toggles last behind a rule, so a test never has
 * to count rows to reach what it acts on.
 */
function moveTo(harness: PickerHarness, text: string): void {
	for (let step = 0; step < 30; step += 1) {
		const selected = harness
			.render(100)
			.map(stripTerminalSequences)
			.find(line => /^\s+▸/.test(line))
		if (selected?.includes(text)) return
		harness.press(PICKER_KEYS.down)
	}
	throw new Error(`no row for ${text}`)
}

/** Session -> scope -> fallbacks, the cursor starting on the first model row. */
async function openChainTab(
	t: test.TestContext,
): Promise<{ harness: PickerHarness; opened: Promise<void> }> {
	const harness = chainHarness(t)
	const { opened } = await openPicker(harness)
	harness.press(PICKER_KEYS.tab)
	harness.press(PICKER_KEYS.tab)
	return { harness, opened }
}

test('alt+down moves a chain entry down and persists the new order', async t => {
	const { harness } = await openChainTab(t)
	moveTo(harness, '1 inco/glm-5.3-flash')

	harness.press(PICKER_KEYS.altDown)

	assert.deepEqual(harness.savedConfigs.at(-1)?.chain, [
		'openrouter/z-ai/glm-5.3-flash',
		'inco/glm-5.3-flash',
	])
})

test('alt+up at the top of the chain is a hard stop, not a wrap', async t => {
	const { harness } = await openChainTab(t)
	moveTo(harness, '1 inco/glm-5.3-flash')

	harness.press(PICKER_KEYS.altUp)

	assert.deepEqual(harness.savedConfigs, [])
})

test('backspace removes the chain entry under the cursor', async t => {
	const { harness } = await openChainTab(t)
	moveTo(harness, '2 openrouter/z-ai/glm-5.3-flash')

	harness.press(PICKER_KEYS.backspace)

	assert.deepEqual(harness.savedConfigs.at(-1)?.chain, ['inco/glm-5.3-flash'])
})

test('enter adds a model to the chain once, even when the view has just changed', async t => {
	const { harness } = await openChainTab(t)
	moveTo(harness, '+ deepseek/deepseek-v4-flash')

	harness.press(PICKER_KEYS.enter)
	harness.press(PICKER_KEYS.enter)

	const chain = harness.savedConfigs.at(-1)?.chain ?? []
	assert.equal(new Set(chain).size, chain.length, 'no entry may repeat')
	assert.equal(chain.at(-1), 'deepseek/deepseek-v4-flash')
	assert.equal(chain.length, 3)
})

test('enter toggles auto-fallback and persists it immediately', async t => {
	const { harness } = await openChainTab(t)
	moveTo(harness, 'auto-fallback on provider failure')

	harness.press(PICKER_KEYS.enter)

	assert.equal(harness.savedConfigs.at(-1)?.autoFallback, false)
	assert.equal(harness.savedConfigs.at(-1)?.restoreOnSuccess, true)
})

test('the chain tab shows failover order and which entry is cooling down', async t => {
	const harness = chainHarness(t)
	harness.cooldowns.set('inco/glm-5.3-flash', Date.now() + 42_000)
	const { opened } = await openPicker(harness)
	harness.press(PICKER_KEYS.tab)
	harness.press(PICKER_KEYS.tab)

	const rendered = frame(harness)

	assert.match(rendered, /1 inco\/glm-5\.3-flash\s+cooling 4[0-2]s/)
	assert.match(rendered, /2 openrouter\/z-ai\/glm-5\.3-flash/)
	assert.match(rendered, /auto-fallback on provider failure/)
	assert.match(rendered, /⌥↑ ⌥↓ reorder/)
	harness.press(PICKER_KEYS.escape)
	await opened
})

test('the scope tab reports the saved patterns and the restart requirement', async t => {
	const harness = chainHarness(t)
	const { opened } = await openPicker(harness)

	harness.press(PICKER_KEYS.tab)
	const rendered = frame(harness)

	assert.match(rendered, /saved scope patterns in settings\.json: 2/)
	assert.match(rendered, /resolved when the picker opened: 4 models/)
	assert.match(rendered, /type \/scoped-models/)
	harness.press(PICKER_KEYS.escape)
	await opened
})

test('the scope and agent tabs never write the settings file they read', async t => {
	const harness = chainHarness(t)
	const before = settingsText(harness)
	const { opened } = await openPicker(harness)

	harness.press(PICKER_KEYS.tab)
	harness.press(PICKER_KEYS.down)
	harness.press(PICKER_KEYS.tab)
	harness.press(PICKER_KEYS.tab)
	harness.press(PICKER_KEYS.down)
	harness.press(PICKER_KEYS.up)
	harness.press(PICKER_KEYS.escape)
	await opened

	assert.equal(settingsText(harness), before)
})

test('the agent tab lists what the subagents package pinned', async t => {
	const harness = chainHarness(t)
	const { opened } = await openPicker(harness)

	harness.press(PICKER_KEYS.tab)
	harness.press(PICKER_KEYS.tab)
	harness.press(PICKER_KEYS.tab)
	const rendered = frame(harness)

	assert.match(
		rendered,
		/inherit the session model unless pinned \(2 pinned\)/,
	)
	assert.match(rendered, /researcher/)
	assert.match(rendered, /inco\/glm-5\.3-flash · high/)
	harness.press(PICKER_KEYS.escape)
	await opened
})

test('the scope tab never claims every model is usable while the session is scoped', async t => {
	// `--models` scoped this session; settings.json names no patterns.
	const harness = scopedHarness(t, { scoped: [ALPHA, BETA] })
	const { opened } = await openPicker(harness)
	harness.press(PICKER_KEYS.tab)

	const rendered = frame(harness)

	assert.match(rendered, /no saved scope patterns/)
	assert.doesNotMatch(rendered, /every available model is usable/)
	assert.match(rendered, /resolved when the picker opened: 2 models/)
	harness.press(PICKER_KEYS.escape)
	await opened
})

test('the scope tab reports an unreadable settings file instead of guessing', async t => {
	const harness = scopedHarness(t, {
		scoped: [ALPHA],
		writeSettings: false,
	})
	const { opened } = await openPicker(harness)
	harness.press(PICKER_KEYS.tab)

	const rendered = frame(harness)

	assert.match(rendered, /settings\.json could not be read/)
	assert.match(rendered, /resolved when the picker opened: 1 models/)
	harness.press(PICKER_KEYS.escape)
	await opened
})

test('the scope tab keeps its native-command note and cursor row on a short screen', async t => {
	const many = Array.from({ length: 24 }, (_, index) =>
		pickerModel({ provider: 'openrouter', id: `model-${String(index)}` }),
	)
	const harness = scopedHarness(t, { scoped: many })
	const { opened } = await openPicker(harness)
	harness.press(PICKER_KEYS.tab)

	const short = harness.render(100, 12)
	assert.ok(short.length <= 12, `scope tab grew to ${short.length} lines`)
	assert.match(
		stripTerminalSequences(short.join('\n')),
		/type \/scoped-models/,
		'the note stays visible when the list is clipped',
	)

	for (let step = 0; step < 23; step += 1) harness.press(PICKER_KEYS.down)
	const scrolled = stripTerminalSequences(harness.render(100, 12).join('\n'))
	assert.match(scrolled, /model-23/, 'the cursor row stays on screen')
	assert.doesNotMatch(scrolled, /model-0\b/, 'the top rows scrolled away')
	assert.match(scrolled, /▲ \d+ above/, 'the hidden rows are accounted for')
	assert.ok(
		harness.render(100, 12).length <= 12,
		'the scope tab fits the short screen instead of overflowing it',
	)

	harness.press(PICKER_KEYS.escape)
	await opened
})

test('the agent tab scrolls its pinned agents on a short screen', async t => {
	const overrides = Object.fromEntries(
		Array.from({ length: 24 }, (_, index) => [
			`agent-${String(index).padStart(2, '0')}`,
			{ model: 'inco/glm-5.3-flash', thinking: 'high' },
		]),
	)
	const harness = scopedHarness(t, {
		scoped: [ALPHA],
		settings: { subagents: { agentOverrides: overrides } },
	})
	const { opened } = await openPicker(harness)
	harness.press(PICKER_KEYS.tab)
	harness.press(PICKER_KEYS.tab)
	harness.press(PICKER_KEYS.tab)

	// The pinned agents are the entries, so they come first; the subagents
	// action is last and is reached by scrolling to it.
	const short = harness.render(100, 12)
	assert.ok(short.length <= 16, `agents tab grew to ${short.length} lines`)
	assert.match(
		stripTerminalSequences(short.join('\n')),
		/agent-00/,
		'the first pinned agent is on screen',
	)
	assert.match(
		stripTerminalSequences(short.join('\n')),
		/▼ \d+ below/,
		'the rows the short screen hides are accounted for',
	)

	for (let step = 0; step < 24; step += 1) harness.press(PICKER_KEYS.down)
	const scrolled = stripTerminalSequences(harness.render(100, 12).join('\n'))
	assert.match(scrolled, /agent-23/, 'the selected pin stays on screen')
	assert.match(scrolled, /open per-agent models/, 'the action row is reached')

	harness.press(PICKER_KEYS.escape)
	await opened
})
