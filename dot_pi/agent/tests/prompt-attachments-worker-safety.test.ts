import assert from 'node:assert/strict'
import test from 'node:test'

import { PreviewService } from '../extensions/prompt-attachments/preview-service.ts'

import { pixelsOf, png } from './png-fixture.ts'
import { StubWorker } from './preview-worker-fixture.ts'

import type { PromptCapture } from '../extensions/prompt-attachments/image-paths.ts'

const BOX = { widthPx: 1, heightPx: 1 }

function capture(imageId: number): PromptCapture {
	return {
		type: 'image',
		mimeType: 'image/png',
		data: png(2, 2, () => [10, 20, 30, 255]),
		alias: `[img:${imageId}]`,
		filePath: '/tmp/shot.png',
		imageId,
	}
}

void test('worker failure never retries image decoding on the UI thread', () => {
	const worker = new StubWorker()
	const service = new PreviewService(
		() => {},
		BOX,
		() => worker,
	)
	const image = capture(1)
	service.request(image)
	worker.fail()
	assert.equal(service.peek(image), image.data)
})

void test('a synchronous worker post failure degrades without throwing', () => {
	const worker = new StubWorker()
	worker.canPost = false
	const service = new PreviewService(
		() => {},
		BOX,
		() => worker,
	)
	const image = capture(1)
	service.request(image)
	assert.equal(service.peek(image), image.data)
})

void test('an idle worker exit cannot strand the next preview', () => {
	const worker = new StubWorker()
	const service = new PreviewService(
		() => {},
		BOX,
		() => worker,
	)
	service.request(capture(1))
	worker.runLast()
	worker.emit('exit', 0)
	const next = capture(2)
	service.request(next)
	assert.equal(service.peek(next), next.data)
})

void test('reset keeps the single-flight slot occupied until the stale job finishes', () => {
	const worker = new StubWorker()
	const service = new PreviewService(
		() => {},
		BOX,
		() => worker,
	)
	const image = capture(1)
	service.request(image)
	service.reset()
	service.request(image)
	assert.equal(worker.submitted.length, 1)
	worker.runLast()
	assert.equal(service.peek(image), undefined)
	assert.equal(worker.submitted.length, 2)
	worker.runLast()
	assert.ok(service.peek(image))
})

void test(
	'a corrupt image does not kill the real worker or block the next preview',
	{ timeout: 2000 },
	async context => {
		let settleNext: (() => void) | undefined = undefined
		const service = new PreviewService(() => settleNext?.(), BOX)
		context.after(() => service.dispose())
		const damaged = Buffer.from(capture(1).data, 'base64')
		const idatPayload = damaged.indexOf('IDAT') + 4
		damaged[idatPayload] = 0
		const corrupt = { ...capture(1), data: damaged.toString('base64') }
		const corruptSettled = new Promise<void>(resolve => {
			settleNext = resolve
		})
		service.request(corrupt)
		await corruptSettled
		assert.equal(service.peek(corrupt), corrupt.data)

		const valid = capture(2)
		const validSettled = new Promise<void>(resolve => {
			settleNext = resolve
		})
		service.request(valid)
		await validSettled
		const preview = service.peek(valid)
		assert.ok(preview)
		assert.equal(pixelsOf(preview).width, 1)
		assert.deepEqual(pixelsOf(preview).at(0, 0), [10, 20, 30, 255])
	},
)

void test('dispose ignores late events and future requests without repainting', async () => {
	const worker = new StubWorker()
	let repaints = 0
	const service = new PreviewService(
		() => {
			repaints += 1
		},
		BOX,
		() => worker,
	)
	service.request(capture(1))
	await service.dispose()
	worker.runLast()
	worker.fail()
	service.request(capture(2))
	assert.equal(repaints, 0)
	assert.equal(worker.isTerminated, true)
	assert.equal(worker.submitted.length, 1)
})
