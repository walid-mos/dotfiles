/** Worker side of preview computation: receives payloads, returns previews. */

import { isMainThread, parentPort } from 'node:worker_threads'

import { scaledPreviewData } from './image-preview.ts'

import type { ImageBox } from './image-preview.ts'

/** One background compute job: capture payload plus the renderer's box. */
export type PreviewJob = {
	readonly key: string
	/** The capture's image payload, base64 as stored on the capture. */
	readonly source: string
	readonly box: ImageBox
}

/** The preview that fits `box`; carried back to the strip renderer. */
export type PreviewResult = {
	readonly key: string
	readonly preview: string
}

/** Runs only as a worker thread: one message in, one base64 preview out. */
if (!isMainThread) {
	parentPort?.on('message', (job: PreviewJob) => {
		const computed: PreviewResult = {
			key: job.key,
			preview: scaledPreviewData(job.source, job.box),
		}
		// Worker threads carry no origins; the targetOrigin rule is DOM-only.
		// oxlint-disable-next-line unicorn/require-post-message-target-origin
		parentPort?.postMessage(computed)
	})
}
