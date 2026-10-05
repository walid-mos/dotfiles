export class SerialQueue {
	private tail: Promise<void> = Promise.resolve()

	async run<Output>(
		operation: () => Promise<Output>,
		signal?: AbortSignal,
	): Promise<Output> {
		const previous = this.tail
		const release = Promise.withResolvers<void>()
		this.tail = release.promise
		await previous
		try {
			signal?.throwIfAborted()
			return await operation()
		} finally {
			release.resolve()
		}
	}
}
