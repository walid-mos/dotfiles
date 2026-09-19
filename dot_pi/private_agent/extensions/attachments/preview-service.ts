/** Session-scoped, single-flight preview worker with a bounded warm cache. */
import { Worker } from 'node:worker_threads'

import type { PromptCapture } from './image-paths.ts'
import type { ImageBox } from './image-preview.ts'
import type { PreviewJob, PreviewResult } from './preview-worker.ts'

export type PreviewSource = {
	peek(capture: PromptCapture): string | undefined
	request(capture: PromptCapture): void
}

/** Owned worker boundary, also driven by deterministic test workers. */
export type WorkerLike = {
	on(event: 'message', listener: (result: PreviewResult) => void): void
	on(event: 'error', listener: (error: Error) => void): void
	on(event: 'exit', listener: (code: number) => void): void
	postMessage(job: PreviewJob): void
	terminate(): Promise<number>
}

const PREVIEW_CACHE_LIMIT = 32

type ActivePreview = { readonly key: string; readonly generation: number }

/** Worker failure preserves the source; decoding never moves onto the UI thread. */
export class PreviewService implements PreviewSource {
	private readonly onSettled: () => void
	private readonly box: ImageBox
	private readonly spawnWorker: () => WorkerLike
	private readonly ready = new Map<string, string>()
	private readonly waiting = new Map<string, string>()
	private worker: WorkerLike | undefined
	private isWorkerUsable = true
	private isDisposed = false
	private active: ActivePreview | undefined
	private generation = 0
	private termination: Promise<number> | undefined

	constructor(
		onSettled: () => void,
		box: ImageBox,
		spawnWorker: () => WorkerLike = defaultWorker,
	) {
		this.onSettled = onSettled
		this.box = box
		this.spawnWorker = spawnWorker
	}

	peek(capture: PromptCapture): string | undefined {
		return this.ready.get(`${capture.imageId}`)
	}

	request(capture: PromptCapture): void {
		const key = `${capture.imageId}`
		if (this.isDisposed || this.ready.has(key) || this.waiting.has(key))
			return
		this.waiting.set(key, capture.data)
		this.dispatch()
	}

	/** Invalidates the draft, but does not pretend the worker stopped its job. */
	reset(): void {
		this.generation += 1
		this.ready.clear()
		this.waiting.clear()
	}

	dispose(): Promise<number> {
		this.isDisposed = true
		this.reset()
		this.stopWorker()
		return this.termination ?? Promise.resolve(0)
	}

	private dispatch(): void {
		if (this.isDisposed || this.active || !this.waiting.size) return
		if (!this.isWorkerUsable) {
			this.preserveSources()
			return
		}
		const [key, source] = firstEntry(this.waiting)
		try {
			const worker = this.ensureWorker()
			this.active = { key, generation: this.generation }
			// Worker threads have no DOM target origin.
			// oxlint-disable-next-line unicorn/require-post-message-target-origin
			worker.postMessage({ key, source, box: this.box })
		} catch {
			this.degrade()
		}
	}

	private ensureWorker(): WorkerLike {
		if (this.worker) return this.worker
		const worker = this.spawnWorker()
		this.worker = worker
		worker.on('message', settled => {
			if (this.worker === worker) this.settle(settled)
		})
		const fail = (): void => {
			if (this.worker === worker) this.degrade()
		}
		worker.on('error', fail)
		worker.on('exit', fail)
		return worker
	}

	private stopWorker(): void {
		const { worker } = this
		this.worker = undefined
		this.active = undefined
		this.isWorkerUsable = false
		// Termination is best-effort after a worker has already failed/exited.
		if (worker) this.termination = terminateWorker(worker)
	}

	private degrade(): void {
		this.stopWorker()
		if (!this.isDisposed) this.preserveSources()
	}

	private preserveSources(): void {
		if (!this.waiting.size) return
		for (const [key, source] of this.waiting) this.cache(key, source)
		this.waiting.clear()
		this.onSettled()
	}

	private settle(settled: PreviewResult): void {
		if (this.isDisposed || this.active?.key !== settled.key) return
		const isCurrentDraft = this.active.generation === this.generation
		this.active = undefined
		if (isCurrentDraft && this.waiting.has(settled.key)) {
			this.waiting.delete(settled.key)
			this.cache(settled.key, settled.preview)
			this.onSettled()
		}
		this.dispatch()
	}

	private cache(key: string, preview: string): void {
		this.ready.set(key, preview)
		while (this.ready.size > PREVIEW_CACHE_LIMIT) {
			this.ready.delete(firstEntry(this.ready)[0])
		}
	}
}

function firstEntry<K, V>(map: Map<K, V>): [K, V] {
	const entry = map.entries().next().value
	if (!entry) throw new Error('Expected a queued preview before dispatch')
	return entry
}

async function terminateWorker(worker: WorkerLike): Promise<number> {
	try {
		return await worker.terminate()
	} catch {
		return 0
	}
}

function defaultWorker(): WorkerLike {
	return new Worker(new URL('./preview-worker.ts', import.meta.url))
}
