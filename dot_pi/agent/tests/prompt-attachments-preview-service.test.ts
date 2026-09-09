import assert from 'node:assert/strict'
import test from 'node:test'

import { toImageAlias } from '../extensions/prompt-attachments/image-paths.ts'
import { PreviewService } from '../extensions/prompt-attachments/preview-service.ts'

import { png as fixturePng, pixelsOf } from './png-fixture.ts'
import { StubWorker } from './preview-worker-fixture.ts'

import type { PromptCapture } from '../extensions/prompt-attachments/image-paths.ts'
import type { ImageBox } from '../extensions/prompt-attachments/image-preview.ts'

const BOX: ImageBox = { widthPx: 16, heightPx: 16 }

function capture(number: number, base64: string): PromptCapture {
	return {
		type: 'image',
		data: base64,
		mimeType: 'image/png',
		alias: toImageAlias(number),
		filePath: `/tmp/pic-${number}.png`,
		imageId: number,
	}
}

/** A real PNG (64x64) that needs downscale so preview compute truly runs. */
function bigPng(): string {
	return fixturePng(64, 64, (x, y) => [(x * 4) % 256, (y * 4) % 256, 60, 255])
}

void test('previews are cold until the worker computes, then warm with exact pixels', () => {
	const worker = new StubWorker()
	let settleCount = 0
	const service = new PreviewService(
		() => {
			settleCount += 1
		},
		BOX,
		() => worker,
	)
	const big = capture(1, bigPng())

	service.request(big)
	assert.equal(service.peek(big), undefined, 'cold until the compute settles')
	assert.equal(settleCount, 0, 'no repaint before settle')

	worker.runLast()

	assert.equal(settleCount, 1, 'exactly one strip repaint')
	const preview = service.peek(big)
	assert.ok(preview, 'the settled compute is warm')
	assert.deepEqual(pixelsOf(preview).width, 16)
	assert.deepEqual(pixelsOf(preview).height, 16)
})

void test('repeat requests for one capture never resubmit a job', () => {
	const worker = new StubWorker()
	const service = new PreviewService(
		() => {},
		BOX,
		() => worker,
	)
	const big = capture(1, bigPng())

	service.request(big)
	service.request(big)
	worker.runLast()
	service.request(big)

	assert.equal(worker.submitted.length, 1, 'one job per capture id, ever')
})

void test('captures queue and run one after another on the single worker', () => {
	const worker = new StubWorker()
	const service = new PreviewService(
		() => {},
		BOX,
		() => worker,
	)

	service.request(capture(1, bigPng()))
	service.request(capture(2, bigPng()))

	assert.equal(worker.submitted.length, 1, 'the worker stays busy first')
	worker.runLast()
	assert.deepEqual(
		worker.submitted.map(job => job.key),
		['1', '2'],
		'the second capture starts once the first settles',
	)
})

void test('a failing worker preserves the original image without inline decoding', () => {
	const worker = new StubWorker()
	const service = new PreviewService(
		() => {},
		BOX,
		() => worker,
	)
	const big = capture(1, bigPng())

	service.request(big)
	worker.fail()

	assert.equal(service.peek(big), big.data)
})

void test('reset clears warm previews and late results are dropped', () => {
	const worker = new StubWorker()
	let settleCount = 0
	const service = new PreviewService(
		() => {
			settleCount += 1
		},
		BOX,
		() => worker,
	)
	const first = capture(1, bigPng())
	const second = capture(2, bigPng())

	service.request(first)
	worker.runLast()
	service.request(second)
	service.reset()

	assert.equal(service.peek(first), undefined, 'reset drops warmed previews')
	worker.runLast()
	assert.equal(
		service.peek(second),
		undefined,
		'a result for a dropped capture lands nowhere',
	)
	assert.equal(settleCount, 1, 'dropped results repaint nothing')
})

void test('dispose terminates the worker thread', async () => {
	const worker = new StubWorker()
	const service = new PreviewService(
		() => {},
		BOX,
		() => worker,
	)
	service.request(capture(1, bigPng()))

	await service.dispose()

	assert.equal(worker.isTerminated, true)
})

void test('end to end: the real worker thread settles a preview', async () => {
	let settled: (() => void) | undefined = undefined
	const settledOnce = new Promise<void>(resolve => {
		settled = resolve
	})
	const service = new PreviewService(() => settled?.(), BOX)
	const big = capture(1, bigPng())

	service.request(big)
	await Promise.race([
		settledOnce,
		resetAfter(2000, 'the real worker did not settle a preview in time'),
	])

	const preview = service.peek(big)
	assert.ok(preview, 'the worker preview is warm')
	assert.equal(pixelsOf(preview).width, 16)
	await service.dispose()
})

/** Rejects after `ms` so slow machines fail loudly instead of hanging. */
function resetAfter(ms: number, message: string): Promise<never> {
	return new Promise((_, reject) => {
		const timer = setTimeout(() => reject(new Error(message)), ms)
		timer.unref()
	})
}
