import assert from 'node:assert/strict'
import test from 'node:test'

import { TelemetrySession } from '../extensions/prompt-telemetry/session.ts'

import type { ActivityPaint } from '../extensions/prompt-telemetry/render.ts'

/** Identity paint: the session passes it straight to the renderer. */
const PAINT: ActivityPaint = {
	data: content => content,
	chrome: content => content,
	track: content => content,
}

const USAGE = {
	input: 12_000,
	output: 3_400,
	cacheRead: 7_000,
	cacheWrite: 1_100,
}

void test('a settled line stays frozen until the next prompt', async () => {
	const session = new TelemetrySession()
	let repaints = 0
	session.bindRepaint(() => {
		repaints += 1
	})

	session.start()
	assert.equal(session.renderActivity(120, PAINT), undefined)

	session.startPrompt()
	session.recordDelta({ type: 'start' })
	session.recordDelta({ type: 'text_delta', delta: 'x'.repeat(400) })
	assert.match(session.renderActivity(120, PAINT) ?? '', /~100 output/u)

	session.recordUsage({ role: 'assistant', usage: USAGE })
	assert.match(session.renderActivity(120, PAINT) ?? '', /3\.4k output/u)

	session.settle()
	const settled = session.renderActivity(120, PAINT) ?? ''
	assert.match(settled, /✓/u)
	assert.ok(repaints >= 3, `expected repaints, saw ${String(repaints)}`)

	await new Promise(resolve => setTimeout(resolve, 25))
	assert.equal(
		session.renderActivity(120, PAINT),
		settled,
		'the frozen line outlives the agent, waiting for the next prompt',
	)

	session.startPrompt()
	assert.match(
		session.renderActivity(120, PAINT) ?? '',
		/waiting for tokens/u,
		'the next prompt takes the line over',
	)
})

void test('a settled line holds its frozen clock while a prompt runs on', () => {
	const session = new TelemetrySession()
	session.start()
	session.startPrompt()
	session.recordUsage({ role: 'assistant', usage: USAGE })
	session.settle()
	const frozen = session.renderActivity(120, PAINT) ?? ''

	session.startPrompt()
	session.recordDelta({ type: 'start' })
	session.recordDelta({ type: 'text_delta', delta: 'x'.repeat(40) })
	const running = session.renderActivity(120, PAINT) ?? ''

	assert.match(frozen, /✓ 00:00/u)
	assert.doesNotMatch(running, /✓/u, 'a live prompt is not frozen')

	session.stop()
	assert.equal(session.renderActivity(120, PAINT), undefined)
})
