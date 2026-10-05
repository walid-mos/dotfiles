import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SerialQueue } from '../extensions/serial-queue.ts'

test('serializes actions and skips cancelled queued work without poisoning later calls', async () => {
	const queue = new SerialQueue()
	const started = Promise.withResolvers<void>()
	const release = Promise.withResolvers<void>()
	const order: string[] = []
	const first = queue.run(async () => {
		order.push('first-start')
		started.resolve()
		await release.promise
		order.push('first-end')
	})
	await started.promise
	const controller = new AbortController()
	const second = queue.run(async () => {
		order.push('cancelled')
	}, controller.signal)
	const rejected = assert.rejects(second, /cancelled/)
	controller.abort(new Error('cancelled'))
	const third = queue.run(async () => {
		order.push('third')
	})
	assert.deepEqual(order, ['first-start'])
	release.resolve()
	await Promise.all([first, rejected, third])
	assert.deepEqual(order, ['first-start', 'first-end', 'third'])
})
