/** Skill invocation callout contracts against Pi's real component, collapsed, expanded and on reload. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { stripVTControlCharacters } from 'node:util'

import {
	SkillInvocationMessageComponent,
	parseSkillBlock,
} from '@earendil-works/pi-coding-agent'

import { installRawTranscriptPatches } from '../extensions/raw-transcript/index.ts'
import { skillToggleKey } from '../extensions/raw-transcript/skill-surface.ts'
import { hexToRgb } from '../extensions/ui/design-system/terminal-color.ts'
import { UI_COLOR } from '../extensions/ui/design-system/theme.ts'
import { terminalLineWidth } from '../extensions/ui/terminal-text.ts'
import { initTheme } from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js'

initTheme('dark')

const ORIGINAL_UPDATE_DISPLAY: unknown = Reflect.get(
	SkillInvocationMessageComponent.prototype,
	'updateDisplay',
)
await installRawTranscriptPatches()

const SKILL_LOCATION =
	'/Users/walid-mos/.pi/agent/skills/dotfiles-sync/SKILL.md'
/** Transcript background green channel: the color the tail must dissolve into. */
const BACKGROUND_GREEN = 241
const SKILL_TEXT = `<skill name="dotfiles-sync" location="${SKILL_LOCATION}">
# Sync dotfiles

Keep chezmoi in step with the live config.
</skill>

Will sync the dotfiles repo.`

function skillCard(): SkillInvocationMessageComponent {
	const block = parseSkillBlock(SKILL_TEXT)
	if (!block) throw new Error('fixture must parse as a skill block')
	return new SkillInvocationMessageComponent(block)
}

function visible(
	row: SkillInvocationMessageComponent,
	width: number,
): string[] {
	return row.render(width).map(stripVTControlCharacters)
}

/** Drive the patched mouse adapter the way Pi's dispatcher does. */
function mouseEvent(
	row: SkillInvocationMessageComponent,
	event: Record<string, unknown>,
): unknown {
	const handleMouse: unknown = Reflect.get(row, 'handleMouse')
	assert.equal(typeof handleMouse, 'function')
	if (typeof handleMouse !== 'function') return undefined
	return Reflect.apply(handleMouse, row, [event])
}

/** Every background color painted on a rendered row, in column order. */
function bandInks(line: string): number[][] {
	return [...line.matchAll(/\u001b\[48;2;(\d+);(\d+);(\d+)m/gu)].map(match =>
		match.slice(1, 4).map(channel => Number(channel)),
	)
}

/** Green channel: base green sits at the top, pink pulls it down. */
function green(ink: number[] | undefined): number {
	return ink?.[1] ?? Number.NaN
}

void test('a collapsed skill card is a rose band with a pink identity line', () => {
	const row = skillCard()
	const lines = visible(row, 80)
	assert.equal(lines.length, 3)
	assert.equal(lines[0]?.trim(), '▎')
	assert.equal(
		lines[1]?.trimEnd(),
		'▎ ✦ skill · dotfiles-sync  (click / ctrl+o to expand)',
	)
	assert.equal(lines[2]?.trim(), '▎')

	const raw = row.render(80)
	const skillInk = `\u001b[38;2;${hexToRgb(UI_COLOR.skill).join(';')}m`
	assert.ok(raw.every(line => line.startsWith('\u001b[48;2;')))
	assert.ok(
		raw[1]?.includes(skillInk),
		'the spine and brand wear the skill ink',
	)
	assert.ok(raw[1]?.includes('\u001b[1m'), 'the skill name stays bold')
	assert.ok(!raw.join('\n').includes(SKILL_LOCATION))
})

void test('the band dissolves from the wash to the background without a seam', () => {
	const inks = bandInks(skillCard().render(80)[1] ?? '')
	assert.ok(inks.length >= 3, 'the tail must be painted in visible steps')
	for (const [index, ink] of inks.entries()) {
		const previous = inks[index - 1]
		if (!previous) continue
		assert.ok(
			green(ink) >= green(previous),
			'the rose may only fade, never step back: a seam would show',
		)
	}
	assert.ok(
		green(inks.at(-1)) >= BACKGROUND_GREEN,
		'the tail must reach the transcript background',
	)
})

void test('the glow also falls off down the card', () => {
	const row = skillCard()
	row.setExpanded(true)
	const peaks = row.render(80).map(line => bandInks(line)[0])
	assert.ok(peaks.length >= 3)
	for (const [index, ink] of peaks.entries()) {
		const previous = peaks[index - 1]
		if (!previous || !ink) continue
		assert.ok(
			green(ink) >= green(previous),
			'the glow may only fall off down the card, never step back',
		)
	}
	assert.ok(
		green(peaks.at(-1)) > green(peaks[0]),
		'the card bottom must be dimmer than its top',
	)
})

void test('an expanded skill card adds the source location and the house body', () => {
	const row = skillCard()
	row.setExpanded(true)
	const lines = visible(row, 80).map(line => line.trimEnd())
	assert.equal(
		lines[1],
		'▎ ✦ skill · dotfiles-sync  (click / ctrl+o to fold)',
	)
	assert.equal(lines[2], `▎ ${SKILL_LOCATION}`)
	assert.equal(lines[3], '▎')
	const body = lines.slice(4).join('\n')
	assert.match(body, /Sync dotfiles/u)
	assert.match(body, /Keep chezmoi in step with the live config\./u)
})

void test('a left click anywhere on the band folds and expands the card', () => {
	const row = skillCard()
	const collapsed = row.render(80).length
	const click = { type: 'click', button: 'left', x: 6, y: 2 }
	assert.deepEqual(mouseEvent(row, click), { handled: true })
	assert.ok(row.render(80).length > collapsed)
	assert.deepEqual(mouseEvent(row, click), { handled: true })
	assert.equal(row.render(80).length, collapsed)
})

void test('drags, releases and non-left clicks never toggle the card', () => {
	const row = skillCard()
	const collapsed = row.render(80).length
	for (const event of [
		{ type: 'press', button: 'left', x: 6, y: 2 },
		{ type: 'drag', button: 'left', x: 6, y: 2 },
		{ type: 'release', button: 'left', x: 6, y: 2 },
		{ type: 'click', button: 'right', x: 6, y: 2 },
	]) {
		assert.equal(mouseEvent(row, event), undefined)
	}
	assert.equal(row.render(80).length, collapsed)
})

void test('narrow viewports drop the hint before the skill identity', () => {
	const joined = visible(skillCard(), 20).join('\n')
	assert.ok(joined.includes('✦ skill ·'))
	assert.ok(joined.includes('dotfiles-sync'))
	assert.ok(!joined.includes('ctrl+o'))
})

for (const width of [1, 2, 5, 8, 20, 80, 200]) {
	void test(`every skill card row fills exactly ${String(width)} terminal columns`, () => {
		const row = skillCard()
		row.setExpanded(true)
		const lines = row.render(width)
		assert.ok(lines.length > 0)
		assert.ok(lines.every(line => terminalLineWidth(line) === width))
	})
}

void test('disposal restores Pi native skill wording and reinstall re-skins it', async () => {
	const dispose = await installRawTranscriptPatches()
	dispose()
	assert.equal(
		Reflect.get(SkillInvocationMessageComponent.prototype, 'updateDisplay'),
		ORIGINAL_UPDATE_DISPLAY,
	)
	const native = visible(skillCard(), 80).join('\n')
	assert.ok(native.includes('[skill]'))
	assert.ok(!native.includes('✦'))

	await installRawTranscriptPatches()
	assert.notEqual(
		Reflect.get(SkillInvocationMessageComponent.prototype, 'updateDisplay'),
		ORIGINAL_UPDATE_DISPLAY,
	)
	assert.match(visible(skillCard(), 80).join('\n'), /✦ skill ·/u)
})

void test('the hint falls back to ctrl+o when Pi exposes no keybindings helper', () => {
	assert.equal(skillToggleKey(undefined), 'ctrl+o')
	assert.equal(
		skillToggleKey(() => ''),
		'ctrl+o',
	)
	assert.equal(
		skillToggleKey(() => 'alt+t'),
		'alt+t',
	)
})
