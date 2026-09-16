/**
 * The grouping contract of the unified picker's lists: a mixed list keeps its
 * models above its options behind a real dim rule, and the session list keeps
 * the scoped models apart from the available rest behind a labeled divider that
 * holds its place while the list scrolls. The divider is a display line, not a
 * row: the cursor still counts rows, so a key can never act on a divider.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { stripTerminalSequences } from '@earendil-works/pi-tui'

import { defaultConfig } from '../extensions/model-fallback/config.ts'
import { uiTheme } from '../extensions/ui/design-system/theme.ts'

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
const BETA = pickerModel({ provider: 'openrouter', id: 'z-ai/glm-5.3-flash' })
const GAMMA = pickerModel({ provider: 'deepseek', id: 'deepseek-v4-flash' })

/** Saved pins, so the agents tab has entries above its own action row. */
const PINNED_AGENTS = {
	subagents: {
		agentOverrides: {
			researcher: { model: 'inco/glm-5.3-flash', thinking: 'high' },
			scout: { model: 'deepseek/deepseek-v4-flash' },
		},
	},
}

/** Session -> scope -> fallbacks -> agents, one tab per press. */
function toTab(
	press: (key: string) => void,
	tab: 'fallbacks' | 'agents',
): void {
	const presses = tab === 'fallbacks' ? 2 : 3
	for (let step = 0; step < presses; step += 1) press(PICKER_KEYS.tab)
}

function frameLines(harness: PickerHarness): string[] {
	return harness.render(100).map(stripTerminalSequences)
}

/** The index of the first line the pattern matches, or a failed assertion. */
function lineMatching(lines: readonly string[], pattern: RegExp): number {
	const index = lines.findIndex(line => pattern.test(line))
	assert.notEqual(index, -1, `no line matches ${String(pattern)}`)
	return index
}

/** A list row's index: rows are inset and carry the reference, headers do not. */
function rowIndex(lines: readonly string[], reference: string): number {
	const index = lines.findIndex(
		line =>
			(line.startsWith(' ▸') || line.startsWith('  ')) &&
			line.includes(reference),
	)
	assert.notEqual(index, -1, `no rendered row for ${reference}`)
	return index
}

function fallbackHarness(t: test.TestContext): PickerHarness {
	const harness = pickerHarness({
		models: [SESSION, ALPHA, BETA, GAMMA],
		current: SESSION,
		scoped: [SESSION, ALPHA, BETA, GAMMA].map(model => ({ model })),
		config: {
			...defaultConfig(),
			chain: [ALPHA, BETA].map(model => `${model.provider}/${model.id}`),
		},
	})
	t.after(() => closeHarness(harness))
	return harness
}

test('the fallbacks tab lists the chain and candidates above the toggles behind a rule', async t => {
	const harness = fallbackHarness(t)
	const { opened } = await openPicker(harness)
	toTab(harness.press, 'fallbacks')

	const lines = frameLines(harness)
	const chainFirst = rowIndex(lines, '1 inco/glm-5.3-flash')
	const chainSecond = rowIndex(lines, '2 openrouter/z-ai/glm-5.3-flash')
	const candidate = rowIndex(lines, '+ deepseek/deepseek-v4-flash')
	const rule = lineMatching(lines, /── options ─+/)
	const toggle = lineMatching(lines, /auto-fallback on provider failure/)

	assert.ok(
		chainFirst < chainSecond && chainSecond < candidate,
		'the chain keeps its failover order above the candidates',
	)
	assert.ok(
		candidate < rule && rule < toggle,
		'the rule separates the model rows from the toggles',
	)
	for (const label of [
		'restore the original model after a clean turn',
		'abort the first attempt on a 5xx',
	])
		assert.ok(
			lineMatching(lines, new RegExp(label)) > rule,
			`${label} stays below the models`,
		)
	// A real visible rule, not a blank gap: a run of box-drawing dashes in the
	// house dim ink, with the section label on it.
	const rawRule = harness.render(100)[rule] ?? ''
	assert.ok(rawRule.includes(uiTheme.fg('dim', '── ')), 'the rule is dim ink')
	assert.ok(
		rawRule.includes(uiTheme.fg('dim', 'options')),
		'the rule carries its label in the same dim ink',
	)

	harness.press(PICKER_KEYS.escape)
	await opened
})

test('a fallbacks list with no model rows lists its options without a separator', async t => {
	// The session model is the only available model, so there is nothing to
	// separate: the toggles are the whole list and no divider pretends otherwise.
	const harness = pickerHarness({ models: [SESSION], current: SESSION })
	t.after(() => closeHarness(harness))
	const { opened } = await openPicker(harness)
	toTab(harness.press, 'fallbacks')

	const lines = frameLines(harness)

	assert.equal(
		lines.filter(line => /── options/.test(line)).length,
		0,
		'no rule above a models group that does not exist',
	)
	assert.notEqual(
		lineMatching(lines, /auto-fallback on provider failure/),
		-1,
	)

	harness.press(PICKER_KEYS.escape)
	await opened
})

test('the session list divides the scoped models from the available rest', async t => {
	const harness = pickerHarness({
		models: [SESSION, ALPHA, BETA, GAMMA],
		current: SESSION,
		scoped: [SESSION, ALPHA, BETA].map(model => ({ model })),
	})
	t.after(() => closeHarness(harness))
	const { opened } = await openPicker(harness)

	const lines = frameLines(harness)
	const scopedRule = lineMatching(lines, /── scoped ─+/)
	const availableRule = lineMatching(lines, /── available ─+/)
	const session = rowIndex(lines, 'openrouter/union-alpha')
	const alpha = rowIndex(lines, 'inco/glm-5.3-flash')
	const beta = rowIndex(lines, 'openrouter/z-ai/glm-5.3-flash')
	const gamma = rowIndex(lines, 'deepseek/deepseek-v4-flash')

	assert.ok(
		scopedRule < session &&
			session < alpha &&
			alpha < beta &&
			beta < availableRule &&
			availableRule < gamma,
		'the scoped models stay above the rule and the available rest below it',
	)

	harness.press(PICKER_KEYS.escape)
	await opened
})

test('the scope divider holds its place while the list scrolls', async t => {
	const available = Array.from({ length: 24 }, (_, index) =>
		pickerModel({
			provider: 'deepseek',
			id: `available-${String(index).padStart(2, '0')}`,
		}),
	)
	const harness = pickerHarness({
		models: [SESSION, ALPHA, ...available],
		current: SESSION,
		scoped: [SESSION, ALPHA].map(model => ({ model })),
	})
	t.after(() => closeHarness(harness))
	const { opened } = await openPicker(harness)

	// Walk onto the first out-of-scope model: the labeled divider must sit
	// directly above it, wherever the window had to scroll.
	for (let step = 0; step < 5; step += 1) {
		const selected = frameLines(harness).find(
			line => line.includes('▸') && line.includes('/'),
		)
		if (selected?.includes('deepseek/available-00')) break
		harness.press(PICKER_KEYS.down)
	}
	const atBoundary = frameLines(harness)
	const selected = atBoundary.findIndex(
		line => line.includes('▸') && line.includes('/'),
	)
	assert.match(atBoundary[selected] ?? '', /deepseek\/available-00/)
	assert.match(atBoundary[selected - 1] ?? '', /── available ─+/)

	// Scroll deeper into the available group: the divider stays on the group's
	// own first row while that row is in the window, never between two rows of
	// the same group.
	for (let step = 0; step < 4; step += 1) harness.press(PICKER_KEYS.down)
	const midScrolled = frameLines(harness)
	const rules = midScrolled
		.map((line, index) => ({ line, index }))
		.filter(({ line }) => /── \w+ ─+/.test(line))
	assert.equal(rules.length, 1, 'the boundary row is still inside the window')
	assert.match(
		midScrolled[(rules[0]?.index ?? 0) + 1] ?? '',
		/available-00/,
		'the divider opens the available group, not a row inside it',
	)

	// Keep scrolling until the boundary is above the window: the divider scrolls
	// off instead of sticking to the frame or drifting into one group.
	for (let step = 0; step < 8; step += 1) harness.press(PICKER_KEYS.down)
	const scrolled = frameLines(harness)

	assert.equal(
		scrolled.filter(line => /── \w+ ─+/.test(line)).length,
		0,
		'no divider floats between two rows of the same group',
	)
	assert.equal(
		scrolled.filter(line => line.includes('inco/glm-5.3-flash')).length,
		0,
		'the scoped group cannot appear below the available rest',
	)
	assert.match(
		scrolled.join('\n'),
		/▲ \d+ above/,
		'the rows the window hides are accounted for',
	)

	harness.press(PICKER_KEYS.escape)
	await opened
})

test('an unrestricted session draws no scope divider', async t => {
	const harness = pickerHarness({
		models: [SESSION, ALPHA, GAMMA],
		current: SESSION,
		scoped: [],
	})
	t.after(() => closeHarness(harness))
	const { opened } = await openPicker(harness)

	const lines = frameLines(harness)

	assert.equal(
		lines.filter(line => /── (scoped|available) ─+/.test(line)).length,
		0,
		'one group needs no boundary',
	)

	harness.press(PICKER_KEYS.escape)
	await opened
})

test('the agents list keeps the pinned agents above the subagents action', async t => {
	const harness = pickerHarness({
		commands: ['subagents'],
		models: [SESSION, ALPHA],
		current: SESSION,
		settings: PINNED_AGENTS,
	})
	t.after(() => closeHarness(harness))
	const { opened } = await openPicker(harness)
	toTab(harness.press, 'agents')

	const lines = frameLines(harness)
	const researcher = lineMatching(lines, /researcher/)
	const rule = lineMatching(lines, /── options ─+/)
	const action = lineMatching(lines, /open per-agent models/)

	assert.ok(
		researcher < rule && rule < action,
		'the action row is an option below the pinned agents',
	)

	harness.press(PICKER_KEYS.escape)
	await opened
})
