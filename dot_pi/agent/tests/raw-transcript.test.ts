/** Submitted prompt contracts against Pi's real component, including resize and reload. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { stripVTControlCharacters } from 'node:util'

import {
	InteractiveMode,
	UserMessageComponent,
} from '@earendil-works/pi-coding-agent'

import { installRawTranscriptPatches } from '../extensions/raw-transcript/index.ts'
import { uiTheme } from '../extensions/ui/design-system/theme.ts'
import { terminalLineWidth } from '../extensions/ui/terminal-text.ts'
import { initTheme } from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js'

initTheme('dark')
const ORIGINAL_ENTRY_MOUNT: unknown = Reflect.get(
	InteractiveMode.prototype,
	'addCustomEntryToChat',
)
const ORIGINAL_USER_REBUILD: unknown = Reflect.get(
	UserMessageComponent.prototype,
	'rebuild',
)
await installRawTranscriptPatches()

function visible(row: UserMessageComponent, width: number): string[] {
	return row.render(width).map(stripVTControlCharacters)
}

void test('submitted prompts have a rounded frame, literal Markdown and preserved paragraph spacing', () => {
	const row = new UserMessageComponent('**prompt**\n\nnext')
	assert.deepEqual(visible(row, 16), [
		'',
		'╭─ Prompt ─────╮',
		'│              │',
		'│ **prompt**   │',
		'│              │',
		'│ next         │',
		'│              │',
		'╰──────────────╯',
		'',
	])
	const rendered = row.render(16)
	assert.ok(
		rendered[1]?.includes(uiTheme.fg('accent', uiTheme.bold('Prompt'))),
	)
	assert.ok(rendered[3]?.includes(uiTheme.fg('text', '**prompt**')))
})

void test('prompt ornament echoes tool rails while the title keeps the Answer accent', () => {
	const row = new UserMessageComponent('Refine the layout.')
	const title = row.render(80)[1] ?? ''
	assert.match(stripVTControlCharacters(title), /^╭─ ❯ Prompt /u)
	assert.ok(title.includes(uiTheme.fg('rail', '❯')))
	assert.ok(title.includes(uiTheme.fg('accent', uiTheme.bold('Prompt'))))
})

void test('compact prompts drop the ornament without sacrificing the label or inner breathing room', () => {
	const row = new UserMessageComponent('hello')
	const lines = visible(row, 23)
	assert.match(lines[1] ?? '', /^╭─ Prompt /u)
	assert.doesNotMatch(lines.join('\n'), /❯/u)
	assert.equal(lines[2]?.slice(2, -2).trim(), '')
	assert.equal(lines.at(-3)?.slice(2, -2).trim(), '')
	assert.match(visible(row, 24)[1] ?? '', /^╭─ ❯ Prompt /u)
})

void test('prompt wrapping budgets for both rails and padding', () => {
	const row = new UserMessageComponent('ABCDEFGHIJK')
	assert.deepEqual(visible(row, 10).slice(3, -3), [
		'│ ABCDEF │',
		'│ GHIJK  │',
	])
})

void test('wrapped Unicode retains every character and keeps joined emoji intact', () => {
	const row = new UserMessageComponent('AB界👩\u200d💻CD')
	const body = visible(row, 10).slice(3, -3)
	assert.ok(body.some(line => line.includes('👩\u200d💻')))
	assert.equal(
		body.map(line => line.slice(2, -2).trimEnd()).join(''),
		'AB界👩\u200d💻CD',
	)
})

void test('multiline source keeps code fences, indentation, blank lines and CRLF paragraphs', () => {
	const row = new UserMessageComponent('```ts\r\n    foo()\r\n\r\n```')
	const sourceLines = visible(row, 24).slice(3, -3)
	assert.deepEqual(
		sourceLines.map(line => line.slice(2, -2).trimEnd()),
		['```ts', '    foo()', '', '```'],
	)
})

void test('narrow viewports give content priority over an unusable frame', () => {
	const row = new UserMessageComponent('abcdef')
	assert.deepEqual(visible(row, 5), ['', 'abcde', 'f', ''])
	assert.deepEqual(visible(row, 0), [])
})

for (const width of [1, 2, 5, 6, 7, 8, 20, 80, 200]) {
	void test(`every prompt row stays within ${String(width)} terminal columns`, () => {
		const row = new UserMessageComponent(
			`**é é 界 👩\u200d💻**\n\n${'x'.repeat(220)}`,
		)
		const lines = row.render(width)
		assert.ok(lines.length > 0)
		assert.ok(lines.every(line => terminalLineWidth(line) <= width))
		if (width >= 6)
			assert.ok(
				lines
					.slice(1, -1)
					.every(line => terminalLineWidth(line) === width),
			)
	})
}

void test('resizing and invalidating reflow the full prompt without accumulating terminal zones', () => {
	const row = new UserMessageComponent('long prompt '.repeat(20))
	const wide = row.render(80)
	assert.ok(row.render(16).length > wide.length)
	row.invalidate()
	assert.deepEqual(row.render(80), wide)
	assert.equal(wide.join('\n').split('\x1b]133;A\x07').length, 2)
	assert.equal(wide.join('\n').split('\x1b]133;C\x07').length, 2)
})

void test('empty prompts do not add a frame or blank transcript rows', () => {
	assert.deepEqual(visible(new UserMessageComponent(' \n\t'), 80), [])
})

void test('disposal restores both native user rendering and attachment-entry mounting', async () => {
	const dispose = await installRawTranscriptPatches()
	dispose()
	assert.equal(
		Reflect.get(InteractiveMode.prototype, 'addCustomEntryToChat'),
		ORIGINAL_ENTRY_MOUNT,
	)
	assert.equal(
		Reflect.get(UserMessageComponent.prototype, 'rebuild'),
		ORIGINAL_USER_REBUILD,
	)
	await installRawTranscriptPatches()
})

void test('reinstalling prompt styling replaces closures without stacked frames or stale disposal', async () => {
	const firstDispose = await installRawTranscriptPatches()
	const before = visible(new UserMessageComponent('user message'), 80)
	await installRawTranscriptPatches()
	firstDispose()
	assert.deepEqual(
		visible(new UserMessageComponent('user message'), 80),
		before,
	)
	assert.equal(before.filter(line => line.includes('╭')).length, 1)
})
