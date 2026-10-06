// Own same-model retry credits and their plans between successful responses, without IO.
// A throttle (429, per-minute limits, capacity) gets its own, longer-waiting
// budget: the same model recovers once its window rolls, and cascading moves a
// 100k-token session onto a model several times the price.
import { isRateLimitFailure } from './taxonomy.ts'

import type { ModelFallbackConfig } from './config.ts'

export interface RetryPlan {
	model: string | undefined
	reason: string
	attempt: number
	limit: number
	delayMs: number
}

type BudgetConfig = Pick<
	ModelFallbackConfig,
	| 'transientRetryLimit'
	| 'retryDelayMs'
	| 'rateLimitRetryLimit'
	| 'rateLimitRetryDelayMs'
>

export class TransientRetryBudget {
	private spentByModel = new Map<string | undefined, number>()

	/** Reserve and describe a retry, or report an exhausted model allowance. */
	claim(
		failure: Pick<RetryPlan, 'model' | 'reason'>,
		config: BudgetConfig,
	): RetryPlan | undefined {
		const throttled = isRateLimitFailure(failure.reason)
		const limit = throttled
			? config.rateLimitRetryLimit
			: config.transientRetryLimit
		const spent = this.spentByModel.get(failure.model) ?? 0
		if (spent >= limit) return undefined
		const attempt = spent + 1
		this.spentByModel.set(failure.model, attempt)
		return {
			...failure,
			attempt,
			limit,
			// A throttle window is time-based: each retry waits longer than the last.
			delayMs: throttled
				? config.rateLimitRetryDelayMs * attempt
				: config.retryDelayMs,
		}
	}

	/** A successful response returns every model's retry credit. */
	reset(): void {
		this.spentByModel.clear()
	}
}
