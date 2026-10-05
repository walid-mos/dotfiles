type OperationOptions = { signal: AbortSignal; timeoutMs: number }

async function closeAfterAbort(
	close: () => Promise<void>,
): Promise<Error | undefined> {
	try {
		await close()
		return undefined
	} catch (error) {
		// Event listeners cannot propagate async failures; the operation observes this below.
		return new Error(
			`Cancelled browser cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		)
	}
}

export async function browserOperation<Output>(
	operation: (signal: AbortSignal) => Promise<Output>,
	close: () => Promise<void>,
	options: OperationOptions,
): Promise<Output> {
	const signal = AbortSignal.any([
		options.signal,
		AbortSignal.timeout(options.timeoutMs),
	])
	let cancellation: Promise<Error | undefined> = Promise.resolve(undefined)
	const cancel = (): void => {
		cancellation = closeAfterAbort(close)
	}
	signal.addEventListener('abort', cancel, { once: true })
	// Rejects the moment the signal fires, so an operation whose promise never
	// settles (a wedged evaluate, a wait with no timeout) cannot hold the tool
	// call hostage past cancellation.
	const aborted = new Promise<never>((_, reject) => {
		signal.addEventListener('abort', () => reject(signal.reason), {
			once: true,
		})
	})
	try {
		signal.throwIfAborted()
		const output = await Promise.race([operation(signal), aborted])
		signal.throwIfAborted()
		return output
	} catch (error) {
		const cleanupFailure = await cancellation
		const reason: unknown = signal.aborted ? signal.reason : error
		const message =
			reason instanceof Error ? reason.message : String(reason)
		throw new Error(
			`Frontend check failed: ${message}${cleanupFailure ? `; ${cleanupFailure.message}` : ''}`,
			{ cause: error },
		)
	} finally {
		signal.removeEventListener('abort', cancel)
		await cancellation
		// Launch may have completed after cancellation; close that late process too.
		if (signal.aborted) await close()
	}
}
