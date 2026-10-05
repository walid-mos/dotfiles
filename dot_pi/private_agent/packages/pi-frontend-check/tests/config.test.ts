import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
	loadConfig,
	resolveExecutable,
	updateConfig,
	validateConfig,
} from '../extensions/config.ts'
import { defaults } from '../extensions/schema.ts'

test('rejects invalid config without coercing booleans, decimals or quality', () => {
	for (const patch of [
		{ HEADLESS: 'false' },
		{ VIEWPORT_WIDTH: 375.5 },
		{ SHOT_QUALITY: 101 },
		{ MAX_CONSOLE: 0 },
		{ EXTRA: true },
	]) {
		assert.throws(
			() => validateConfig({ ...defaults, ...patch }),
			/Invalid frontend-check/,
		)
	}
})

test('refuses visible browser mode from commands and saved configuration', context => {
	assert.throws(
		() => updateConfig(defaults, 'HEADLESS=false'),
		/Invalid frontend-check/,
	)
	const directory = mkdtempSync(join(tmpdir(), 'frontend-headless-test-'))
	context.after(() => rmSync(directory, { recursive: true, force: true }))
	const path = join(directory, 'config.json')
	writeFileSync(path, JSON.stringify({ HEADLESS: false }))
	assert.throws(() => loadConfig(path), /Could not load/)
})

test('accepts executable paths containing spaces as one setting', () => {
	assert.equal(
		updateConfig(
			defaults,
			'EXECUTABLE_PATH=/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
		).EXECUTABLE_PATH,
		'/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
	)
	assert.throws(
		() => updateConfig(defaults, 'HEADLESS=0'),
		/Invalid frontend-check/,
	)
	assert.throws(() => updateConfig(defaults, 'SHOT_QUALITY=80oops'))
})

test('defaults require no config writes, malformed existing config fails loudly', context => {
	const directory = mkdtempSync(join(tmpdir(), 'frontend-config-test-'))
	context.after(() => rmSync(directory, { recursive: true, force: true }))
	const path = join(directory, 'config.json')
	assert.equal(loadConfig(path).HEADLESS, true)
	writeFileSync(path, '{invalid')
	assert.throws(() => loadConfig(path), /Could not load/)
	writeFileSync(path, 'null')
	assert.throws(() => loadConfig(path), /Could not load/)
})

test('invalid explicit executable fails instead of falling back or downloading', () => {
	assert.throws(
		() => resolveExecutable('/no-such-browser/frontend-check'),
		/EXECUTABLE_PATH/,
	)
})
