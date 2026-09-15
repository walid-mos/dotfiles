import assert from 'node:assert/strict'
import test from 'node:test'

import { ActivityClock } from '../extensions/ui/activity-clock.ts'

void test('one lazy pulse repaints a shared TUI once, even with concurrent tools', () => {
	let tick: () => void
	const pulse = (): void => {
		tick()
	}
	let schedules = 0
	let cancellations = 0
	let repaints = 0
	const clock = new ActivityClock(
		() => 0,
		callback => {
			tick = callback
			schedules += 1
			return () => {
				cancellations += 1
			}
		},
	)
	const first = {}
	const second = {}
	const repaint = (): void => {
		repaints += 1
	}
	assert.equal(schedules, 0)
	clock.watch(first, repaint)
	clock.watch(second, repaint)
	pulse()
	assert.equal(schedules, 1)
	assert.equal(repaints, 1)
	clock.release(first)
	assert.equal(cancellations, 0)
	clock.release(second)
	assert.equal(cancellations, 1)
	clock.dispose()
	clock.watch({}, repaint)
	assert.equal(
		schedules,
		1,
		'disposed clocks cannot restart from stale component closures',
	)
})
