/**
 * The inline agent editor: an agent row opens a model search in place, and the
 * chosen model plus thinking level is merged into `subagents.agentOverrides`
 * for that agent alone. The picker writes only those two keys, keeps every
 * other key and the file's own indentation, and reports the launch-time effect;
 * escape leaves the file untouched and returns to the agents tab.
 */

import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import test from 'node:test'

import { stripTerminalSequences } from '@earendil-works/pi-tui'

import {
	closeHarness,
	openPicker,
	pickerHarness,
	pickerModel,
	settingsText,
} from './picker-harness-fixture.ts'
import { PICKER_KEYS } from './picker-keys-fixture.ts'

import type { PickerHarness } from './picker-harness-fixture.ts'

const SESSION = pickerModel({ provider: 'openrouter', id: 'union-alpha' })
/** off/high/max, so the pinned `high` is a level this model actually accepts. */
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
/** off/high/max: a model that accepts the extended levels and skips the rest. */
const THINKING = pickerModel({
	provider: 'openrouter',
	id: 'z-ai/glm-5.3-thinker',
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

const THINKING_LEVELS = ['off', 'high', 'max']

/** Two pinned agents and keys the editor must never touch. */
const SETTINGS = {
	keep: { nested: true },
	enabledModels: ['openrouter/union-alpha'],
	subagents: {
		agentOverrides: {
			researcher: {
				model: 'inco/glm-5.3-flash',
				thinking: 'high',
				fallbackModels: ['openrouter/z-ai/glm-5.3-thinker'],
			},
			scout: { model: 'openrouter/union-alpha' },
		},
	},
}

function editorHarness(t: test.TestContext): PickerHarness {
	const harness = pickerHarness({
		commands: ['subagents'],
		models: [SESSION, PINNED, THINKING],
		current: SESSION,
		settings: SETTINGS,
	})
	t.after(() => closeHarness(harness))
	return harness
}

/** The frame with its styling removed: assertions read text, not ANSI codes. */
function frame(harness: PickerHarness): string {
	return stripTerminalSequences(harness.render(100).join('\n'))
}

/** The row under the cursor, as the frame renders it. */
function selectedRow(harness: PickerHarness): string {
	const line = harness
		.render(100)
		.map(stripTerminalSequences)
		.find(row => /^\s+▸/.test(row))
	assert.ok(line, 'expected a selected row')
	return line
}

/** Walk the cursor onto a row by the text that row shows. */
function selectRow(harness: PickerHarness, text: string): void {
	for (let step = 0; step < 12; step += 1) {
		if (selectedRow(harness).includes(text)) return
		harness.press(PICKER_KEYS.down)
	}
	throw new Error(`no row for ${text}`)
}

/** Session -> scope -> fallbacks -> agents, then onto one pinned agent. */
async function openEditor(
	t: test.TestContext,
	agent = 'researcher',
): Promise<{ harness: PickerHarness; opened: Promise<void> }> {
	const harness = editorHarness(t)
	const { opened } = await openPicker(harness)
	for (let step = 0; step < 3; step += 1) harness.press(PICKER_KEYS.tab)
	selectRow(harness, agent)
	harness.press(PICKER_KEYS.enter)
	return { harness, opened }
}

function type(harness: PickerHarness, text: string): void {
	for (const key of text) harness.press(key)
}

function savedSettings(harness: PickerHarness): Record<string, unknown> {
	return record(JSON.parse(readFileSync(harness.settingsPath, 'utf8')))
}

/** A JSON object, walked without a type assertion. */
function record(candidate: unknown): Record<string, unknown> {
	if (
		typeof candidate !== 'object' ||
		candidate === null ||
		Array.isArray(candidate)
	)
		throw new Error(`expected a JSON object, got ${typeof candidate}`)
	const copy: Record<string, unknown> = {}
	for (const [key, entry] of Object.entries(candidate)) copy[key] = entry
	return copy
}

/** The `subagents.agentOverrides` map of a saved settings file. */
function savedOverrides(harness: PickerHarness): Record<string, unknown> {
	return record(record(savedSettings(harness)['subagents'])['agentOverrides'])
}

test('enter on a pinned agent opens the editor on that agent and its own model', async t => {
	const { harness } = await openEditor(t)

	const rendered = frame(harness)

	assert.match(rendered, /editing researcher/)
	assert.match(rendered, /pinned inco\/glm-5\.3-flash/)
	assert.match(rendered, /Type to search/)
	assert.ok(
		selectedRow(harness).includes('inco/glm-5.3-flash'),
		'the cursor starts on the model the agent pins',
	)
	assert.ok(
		selectedRow(harness).includes('pinned'),
		'the pinned model is marked as such',
	)
	assert.equal(settingsText(harness), JSON.stringify(SETTINGS, null, '\t'))

	harness.press(PICKER_KEYS.escape)
	assert.equal(frame(harness).includes('editing researcher'), false)
	assert.match(frame(harness), /open per-agent models/)
})

test('the editor saves the chosen model and thinking level for that agent', async t => {
	const { harness, opened } = await openEditor(t)

	type(harness, 'thinker')
	assert.ok(
		selectedRow(harness).includes('openrouter/z-ai/glm-5.3-thinker'),
		'the search narrows the catalogue to the chosen model',
	)
	harness.press(PICKER_KEYS.right)
	harness.press(PICKER_KEYS.right)
	assert.ok(
		selectedRow(harness).includes('high'),
		'two steps reach the model\u2019s second level',
	)
	harness.press(PICKER_KEYS.enter)

	assert.deepEqual(savedOverrides(harness)['researcher'], {
		model: 'openrouter/z-ai/glm-5.3-thinker',
		thinking: 'high',
		fallbackModels: ['openrouter/z-ai/glm-5.3-thinker'],
	})
	assert.deepEqual(
		savedOverrides(harness)['scout'],
		{ model: 'openrouter/union-alpha' },
		'another agent\u2019s pin is untouched',
	)
	assert.deepEqual(savedSettings(harness)['enabledModels'], [
		'openrouter/union-alpha',
	])
	assert.deepEqual(savedSettings(harness)['keep'], { nested: true })
	assert.match(
		settingsText(harness),
		/\n\t"subagents"/,
		'a tab-indented file keeps its own indentation',
	)

	// The editor closes back onto the agents tab, showing what it saved, and
	// the notice is honest about when the pin takes effect.
	assert.equal(frame(harness).includes('editing researcher'), false)
	assert.match(frame(harness), /researcher/)
	assert.match(frame(harness), /glm-5\.3-thinker · high/)
	assert.match(harness.notices.join('\n'), /next launch/)
	harness.press(PICKER_KEYS.escape)
	harness.press(PICKER_KEYS.escape)
	await opened
})

test('the editor steps only the levels pi reports for the chosen model', async t => {
	const { harness } = await openEditor(t)

	type(harness, 'thinker')
	const visited = new Set<string>()
	for (let step = 0; step < 7; step += 1) {
		harness.press(PICKER_KEYS.right)
		const row = selectedRow(harness)
		const level = THINKING_LEVELS.find(name => row.includes(name))
		assert.ok(level, `no level pi reports in the row: ${row}`)
		visited.add(level)
	}
	assert.deepEqual(
		[...visited].toSorted(),
		['high', 'max', 'off'],
		'a model with holes never shows a level it does not accept',
	)

	harness.press(PICKER_KEYS.enter)
	const { thinking } = record(savedOverrides(harness)['researcher'])
	assert.ok(
		THINKING_LEVELS.includes(String(thinking)),
		'the level saved is one the model accepts',
	)
})

test('the editor keeps the indentation the settings file already uses', async t => {
	const { harness } = await openEditor(t)
	// The file on disk decides its indentation, not the writer.
	writeFileSync(
		harness.settingsPath,
		`${JSON.stringify(SETTINGS, null, 2)}\n`,
	)

	type(harness, 'thinker')
	harness.press(PICKER_KEYS.enter)

	const text = settingsText(harness)
	assert.equal(text.includes('\t'), false, 'a two-space file stays two-space')
	assert.match(text, /\n  "subagents"/)
	assert.match(text, /\n      "researcher"/)
	assert.deepEqual(
		record(savedOverrides(harness)['researcher'])['model'],
		'openrouter/z-ai/glm-5.3-thinker',
	)
})

/** The search row's text, styled text removed. */
function searchText(harness: PickerHarness): string {
	const found = harness
		.render(100)
		.map(line => stripTerminalSequences(line))
		.find(line => line.trimStart().startsWith('/'))
	assert.ok(found, 'expected a search row')
	return found.trimEnd()
}

test('escape returns from the editor to the agents tab without writing', async t => {
	const { harness } = await openEditor(t)
	type(harness, 'thinker')
	assert.match(searchText(harness), /\/ thinker/)
	const before = settingsText(harness)

	// Search first, the editor second: escape clears what it can, one level
	// at a time.
	harness.press(PICKER_KEYS.escape)
	assert.match(frame(harness), /editing researcher/, 'still in the editor')
	assert.match(searchText(harness), /Type to search/, 'the search is clear')

	harness.press(PICKER_KEYS.escape)
	assert.equal(frame(harness).includes('editing researcher'), false)
	assert.match(frame(harness), /open per-agent models/)
	assert.ok(
		selectedRow(harness).includes('researcher'),
		'back on the row the editor was opened from',
	)
	assert.equal(settingsText(harness), before, 'escape writes nothing')
})

test('a click on a pinned agent row opens its editor', async t => {
	const harness = editorHarness(t)
	const { opened } = await openPicker(harness)
	for (let step = 0; step < 3; step += 1) harness.press(PICKER_KEYS.tab)

	const row = harness
		.render(100)
		.findIndex(line => stripTerminalSequences(line).includes('researcher'))
	assert.notEqual(row, -1)
	harness.mouse({ type: 'click', lineIndex: row })

	assert.match(frame(harness), /editing researcher/)
	harness.press(PICKER_KEYS.escape)
	harness.press(PICKER_KEYS.escape)
	await opened
})

test('a failed settings write keeps the editor open and the file untouched', async t => {
	const { harness } = await openEditor(t)

	writeFileSync(harness.settingsPath, '{broken')
	harness.press(PICKER_KEYS.right)
	harness.press(PICKER_KEYS.enter)

	assert.match(frame(harness), /editing researcher/, 'the edit is not lost')
	assert.match(harness.notices.join('\n'), /cannot update settings\.json/)
	assert.equal(
		settingsText(harness),
		'{broken',
		'the broken file is not clobbered',
	)
})

test('saving the pin the agent already has writes nothing', async t => {
	const { harness } = await openEditor(t)
	const before = settingsText(harness)

	// The cursor opens on the pinned model at its pinned level: enter changes
	// nothing, so there is nothing to write and no notice to show.
	harness.press(PICKER_KEYS.enter)

	assert.equal(settingsText(harness), before)
	assert.deepEqual(harness.notices, [])
	assert.equal(frame(harness).includes('editing researcher'), false)
})
