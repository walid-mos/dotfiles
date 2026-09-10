import assert from 'node:assert/strict'
import test from 'node:test'

import { TelemetrySession } from '../extensions/prompt-telemetry/session.ts'

import type { Theme } from '@earendil-works/pi-coding-agent'

/** Identity theme: the session only needs `fg` to render its line. */
// oxlint-disable-next-line nextnode/no-type-assertion typescript/no-unsafe-type-assertion
const THEME = {
	fg: (_color: string, content: string) => content,
} as Theme

/** The session reads the theme on every render, never a captured snapshot. */
const readTheme = (): Theme => THEME

const USAGE = {
	input: 12_000,
	output: 3_400,
	cacheRead: 7_000,
	cacheWrite: 1_100,
}

void test('a settled line retires itself after the linger', async () => {
	const session = new TelemetrySession({ lingerMs: 5 })
	let repaints = 0
	session.bindRepaint(() => {
		repaints += 1
	})

	session.start(readTheme)
	assert.equal(session.renderLine(120), undefined)

	session.startPrompt()
	session.recordDelta({ type: 'start' })
	session.recordDelta({ type: 'text_delta', delta: 'x'.repeat(400) })
	assert.match(session.renderLine(120) ?? '', /~100 output/u)

	session.recordUsage({ role: 'assistant', usage: USAGE })
	assert.match(session.renderLine(120) ?? '', /3\.4k output/u)

	session.settle()
	assert.match(session.renderLine(120) ?? '', /✓/u)
	assert.ok(repaints >= 3, `expected repaints, saw ${String(repaints)}`)

	await new Promise(resolve => setTimeout(resolve, 25))
	assert.equal(session.renderLine(120), undefined)
	assert.ok(
		repaints >= 4,
		`expected the retire repaint, saw ${String(repaints)}`,
	)
})

void test('a new prompt takes the line over before the linger expires', async () => {
	const session = new TelemetrySession({ lingerMs: 5 })
	session.start(readTheme)
	session.startPrompt()
	session.settle()
	session.startPrompt()

	assert.match(session.renderLine(120) ?? '', /waiting for tokens/u)

	await new Promise(resolve => setTimeout(resolve, 25))
	assert.match(session.renderLine(120) ?? '', /waiting for tokens/u)

	session.stop()
	assert.equal(session.renderLine(120), undefined)
})
