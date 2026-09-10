import assert from 'node:assert/strict'
import test from 'node:test'

import { stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui'

import {
	composeActivityBorder,
	createActivityPaint,
	installActivityBorder,
} from '../extensions/prompt-telemetry/activity-border.ts'
import { THINKING_WORKING_WORDS } from '../extensions/thinking-working/words.ts'
import { uiTheme } from '../extensions/ui/design-system/theme.ts'
import { EMBEDDED_LOADER_FIELD_WIDTH } from '../extensions/ui/editor-decorator.ts'

import type {
	ActivityBorderHost,
	ActivitySlot,
} from '../extensions/prompt-telemetry/activity-border.ts'

const LOADER = '⠋ Pondering'
/** `── ` prefix, spinner, message, and the space before the dashes resume. */
const LOADER_CHROME_WIDTH = 6
const PROMPT_WIDTH = 80
const BLOCK = 'BLOCK'

/** Border pi renders for an idle editor of the given width. */
function dashBorder(width: number): string {
	return '─'.repeat(width)
}

/** Border pi renders while working: loader at the left, dashes filling the rest. */
function loaderBorder(loader: string, width: number): string {
	const prefix = `── ${loader} `
	return prefix + '─'.repeat(width - visibleWidth(prefix))
}

/** Slot as the hook builds it, with the house loader reserve. */
function slot(width: number): ActivitySlot {
	return { width, loaderWidth: EMBEDDED_LOADER_FIELD_WIDTH }
}

/** Visible layout of a composed border; styling is asserted by width instead. */
function layout(border: string): string {
	return stripTerminalSequences(border)
}

/** A host that renders one border line, plus whatever else the caller passes. */
function borderHost(
	border: string,
	extraLines: readonly string[] = [],
): ActivityBorderHost {
	return { render: () => [border, ...extraLines] }
}

void test('the reserve covers the widest loader message the house can show', () => {
	const widest = THINKING_WORKING_WORDS.reduce(
		(widestSoFar, word) => Math.max(widestSoFar, visibleWidth(word)),
		0,
	)

	assert.ok(
		widest + LOADER_CHROME_WIDTH <= EMBEDDED_LOADER_FIELD_WIDTH,
		`word of ${String(widest)} columns does not fit the reserve`,
	)
})

void test('puts the block flush with the right edge, one dash of margin', () => {
	const line = composeActivityBorder(
		dashBorder(PROMPT_WIDTH),
		BLOCK,
		slot(PROMPT_WIDTH),
		undefined,
	)

	assert.equal(layout(line), `${'─'.repeat(74)}BLOCK─`)
})

void test('keeps the block in place while the loader message rotates', () => {
	const shortLoader = loaderBorder(LOADER, PROMPT_WIDTH)
	const longLoader = loaderBorder('⠋ Flibbertigibbering', PROMPT_WIDTH)
	const place = (border: string): string => {
		const host = borderHost(border)
		installActivityBorder(host, () => BLOCK)
		return layout(host.render(PROMPT_WIDTH)[0] ?? '')
	}

	const loaderEnd = visibleWidth(`── ${LOADER} `)

	assert.equal(
		place(shortLoader).indexOf(BLOCK),
		place(longLoader).indexOf(BLOCK),
	)
	assert.ok(place(shortLoader).indexOf(BLOCK) > loaderEnd)
	assert.ok(place(shortLoader).startsWith(`── ${LOADER} `))
})

void test('keeps clear of a loader wider than the reserve', () => {
	const loader = `⠋ ${'M'.repeat(30)}`
	const width = 46
	const line = composeActivityBorder(
		loaderBorder(loader, width),
		BLOCK,
		slot(width),
		undefined,
	)

	assert.ok(layout(line).startsWith(`── ${loader} `), layout(line))
	assert.equal(layout(line).indexOf(BLOCK), 40)
})

void test('leaves the block out when the loader and the border leave no room', () => {
	const border = loaderBorder(`⠋ ${'M'.repeat(30)}`, 40)

	assert.equal(
		composeActivityBorder(border, BLOCK, slot(40), undefined),
		border,
	)
})

void test("keeps pi's scroll label and puts the block after it", () => {
	const loader = loaderBorder(LOADER, PROMPT_WIDTH)
	const label = ' ↑ 3 more '
	const scrolled = `${loader.slice(0, 15)}${'─'.repeat(4)}${label}${'─'.repeat(PROMPT_WIDTH - 15 - 4 - label.length)}`
	const line = composeActivityBorder(
		scrolled,
		BLOCK,
		slot(PROMPT_WIDTH),
		undefined,
	)

	assert.ok(layout(line).includes(label), layout(line))
	assert.ok(layout(line).indexOf(BLOCK) > layout(line).indexOf(label))
})

void test('leaves a line that is not a border alone', () => {
	const host = borderHost('prompt text')
	installActivityBorder(host, () => BLOCK)

	assert.deepEqual(host.render(PROMPT_WIDTH), ['prompt text'])
})

void test('leaves the block out when it does not fit the reserved space', () => {
	const border = dashBorder(40)

	assert.equal(
		composeActivityBorder(border, 'B'.repeat(20), slot(40), undefined),
		border,
	)
})

void test('keeps the editor width for styled borders and blocks', () => {
	for (const width of [30, 33, 60, 79, 120]) {
		const line = composeActivityBorder(
			uiTheme.fg('dim', loaderBorder(LOADER, width)),
			uiTheme.fg('muted', '◴ 00:03  ━━━───  1.2k output'),
			slot(width),
			text => uiTheme.fg('dim', text),
		)
		assert.equal(
			visibleWidth(line),
			width,
			`width ${String(width)}: ${line}`,
		)
	}
})

void test('an idle block leaves the rendered lines untouched', () => {
	const host = borderHost(loaderBorder(LOADER, PROMPT_WIDTH))
	installActivityBorder(host, () => undefined)

	assert.deepEqual(host.render(PROMPT_WIDTH), [
		loaderBorder(LOADER, PROMPT_WIDTH),
	])
})

void test('hands the reader the reserved space as its width budget', () => {
	const budgets: number[] = []
	const host = borderHost(loaderBorder('⠋ Flibbertigibbering', PROMPT_WIDTH))
	installActivityBorder(host, maxWidth => {
		budgets.push(maxWidth)
		return undefined
	})

	host.render(PROMPT_WIDTH)

	assert.deepEqual(budgets, [PROMPT_WIDTH - EMBEDDED_LOADER_FIELD_WIDTH - 2])
})

void test('replaces the top border with the composed one and keeps the editor lines', () => {
	const host = borderHost(dashBorder(PROMPT_WIDTH), ['prompt'])
	installActivityBorder(host, () => BLOCK)

	assert.deepEqual(host.render(PROMPT_WIDTH).map(layout), [
		`${'─'.repeat(74)}BLOCK─`,
		'prompt',
	])
})

void test('dresses the readings in the loading color and the words in muted ink', () => {
	const paint = createActivityPaint(() => text => uiTheme.fg('border', text))

	assert.equal(
		paint.data('12k'),
		uiTheme.fg('border', '12k'),
		'the numbers wear the loader color',
	)
	assert.equal(paint.track('────'), uiTheme.fg('border', '────'))
	assert.ok(
		luminance(paint.chrome(' input')) >
			luminance(uiTheme.fg('muted', ' input')),
		'the words stay quieter than the house ink',
	)
})

void test('falls back to quiet ink when the editor exposes no loading color', () => {
	const paint = createActivityPaint(() => undefined)

	assert.equal(
		paint.track('──'),
		paint.data('──'),
		'the track falls back with the readings',
	)
	assert.ok(
		luminance(paint.data('12k')) > luminance(uiTheme.fg('muted', '12k')),
		'readings stay quieter than the house ink without a loader color',
	)
})

/** Luminance of the color a truecolor foreground sequence carries. */
function luminance(painted: string): number {
	const match = /\u001b\[38;2;(\d+);(\d+);(\d+)m/u.exec(painted)
	assert.ok(match, `no truecolor sequence in ${painted}`)
	const [, red, green, blue] = match
	return (
		0.2126 * Number(red ?? 0) +
		0.7152 * Number(green ?? 0) +
		0.0722 * Number(blue ?? 0)
	)
}

void test('reads the border color when painting, not when wiring', () => {
	let level: 'border' | 'accent' = 'border'
	const paint = createActivityPaint(() => text => uiTheme.fg(level, text))
	level = 'accent'

	assert.equal(paint.track('──'), uiTheme.fg('accent', '──'))
})
