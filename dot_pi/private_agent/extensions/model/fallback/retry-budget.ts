// Own same-model retry credits and their plans between successful responses, without IO.
import type { ModelFallbackConfig } from './config.ts'

export interface RetryPlan {
	model: string | undefined
	reason: string
	attempt: number
	limit: number
	delayMs: number
}

export class TransientRetryBudget {
	private spentByModel = new Map<string | undefined, number>()

	/** Reserve and describe a retry, or report an exhausted model allowance. */
	claim(
		failure: Pick<RetryPlan, 'model' | 'reason'>,
		config: Pick<
			ModelFallbackConfig,
			'transientRetryLimit' | 'retryDelayMs'
		>,
	): RetryPlan | undefined {
		const spent = this.spentByModel.get(failure.model) ?? 0
		if (spent >= config.transientRetryLimit) return undefined
		const attempt = spent + 1
		this.spentByModel.set(failure.model, attempt)
		return {
			...failure,
			attempt,
			limit: config.transientRetryLimit,
			delayMs: config.retryDelayMs,
		}
	}

	/** A successful response returns every model's retry credit. */
	reset(): void {
		this.spentByModel.clear()
	}
}
