/** Controllable worker boundary; jobs only finish when the test delivers them. */
import { EventEmitter } from 'node:events'

import { scaledPreviewData } from '../extensions/prompt-attachments/image-preview.ts'

import type { WorkerLike } from '../extensions/prompt-attachments/preview-service.ts'
import type { PreviewJob } from '../extensions/prompt-attachments/preview-worker.ts'

export class StubWorker extends EventEmitter implements WorkerLike {
	readonly submitted: PreviewJob[] = []
	isTerminated = false
	canPost = true

	postMessage(job: PreviewJob): void {
		if (!this.canPost) throw new Error('Worker is unavailable')
		this.submitted.push(job)
	}

	runLast(): void {
		const job = this.submitted.at(-1)
		if (!job) throw new Error('Expected a submitted preview job')
		this.emit('message', {
			key: job.key,
			preview: scaledPreviewData(job.source, job.box),
		})
	}

	fail(): void {
		this.emit('error', new Error('Worker failed'))
	}

	terminate(): Promise<number> {
		this.isTerminated = true
		return Promise.resolve(0)
	}
}
