type WaitOutcome = 'settled' | 'elapsed' | 'aborted'

/** Detachable listeners avoid retaining each timed-out wait on a permanent job. */
export function waitForJob(
	settled: AbortSignal,
	milliseconds: number,
	signal?: AbortSignal,
): Promise<WaitOutcome> {
	if (signal?.aborted) return Promise.resolve('aborted')
	if (settled.aborted) return Promise.resolve('settled')
	return new Promise(resolve => {
		const finish = (outcome: WaitOutcome): void => {
			clearTimeout(timer)
			settled.removeEventListener('abort', onSettled)
			signal?.removeEventListener('abort', onAbort)
			resolve(outcome)
		}
		const onSettled = (): void => finish('settled')
		const onAbort = (): void => finish('aborted')
		const timer = setTimeout(() => finish('elapsed'), milliseconds)
		settled.addEventListener('abort', onSettled, { once: true })
		signal?.addEventListener('abort', onAbort, { once: true })
	})
}
