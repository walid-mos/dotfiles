// Failure classification for model fallback: an HTTP status or an error text is
// either evidence that another model can serve the turn, or evidence that it
// cannot. Pure, no state. Unit-tested in `../tests/model-fallback.test.ts`.
//
// Context overflow is deliberately NOT retryable: the input was too large for
// the model's window, so pi routes it to compaction and no other model helps.

export type HttpFailureClass = 'failover-fast' | 'failover-slow' | 'none'
export type FailureTextClass = 'retryable' | 'overflow' | 'terminal'

const NOT_FOUND = 404
const REQUEST_TIMEOUT = 408
const TOO_MANY_REQUESTS = 429
const SERVER_ERROR_MIN = 500
const SERVER_ERROR_MAX = 599

/** Rate limit, timeout, missing model: pi's own retry may still recover. */
const SLOW_FAILURE_STATUSES = new Set([
	NOT_FOUND,
	REQUEST_TIMEOUT,
	TOO_MANY_REQUESTS,
])

/**
 * `failover-fast` marks an unhealthy provider endpoint (5xx): the fast-failover
 * path aborts the doomed attempt instead of letting pi retry it three times.
 * `failover-slow` (rate limit, timeout, missing model) may recover on its own,
 * so the turn is left to pi's own retry before failover.
 */
export function classifyStatus(status: number): HttpFailureClass {
	if (status >= SERVER_ERROR_MIN && status <= SERVER_ERROR_MAX) {
		return 'failover-fast'
	}
	if (!SLOW_FAILURE_STATUSES.has(status)) return 'none'
	return 'failover-slow'
}

const RETRYABLE_PATTERNS = [
	/^REQUEST_LIMIT_EXCEEDED$/,
	/rate\s*limit/i,
	/usage\s*limit/i,
	/too many requests/i,
	/\b429\b/,
	/quota/i,
	/billing/i,
	/credit/i,
	// OpenRouter can return only a status-prefixed body, without auth-related prose.
	/^\s*401\s*:/,
	/auth(?:entication)?/i,
	/unauthori[sz]ed/i,
	/forbidden/i,
	/api key/i,
	/token expired/i,
	/invalid key/i,
	/provider.*unavailable/i,
	/model.*unavailable/i,
	/model.*disabled/i,
	/model.*not found/i,
	/unknown model/i,
	/overloaded/i,
	/service unavailable/i,
	/temporar(?:ily)? unavailable/i,
	/connection\s+(?:error|reset|closed|aborted)/i,
	/connection refused/i,
	/fetch failed/i,
	/network error/i,
	/socket hang up/i,
	/stream ended without finish_reason/i,
	/upstream/i,
	/timed? out/i,
	/timeout/i,
	/\b50[0-4]\b/,
	/internal server error/i,
	/cold.?start/i,
	/empty response/i,
	/no output/i,
	/model.*(?:load|fail|error)/i,
]

const OVERFLOW_PATTERNS = [
	/context(?: length| window| limit)? (?:exceed|overflow|too long)/i,
	/maximum context length/i,
	/too many tokens/i,
	/token limit/i,
	/context_length_exceeded/i,
	/length_required/i,
	/maximum.*tokens/i,
	/prompt.*too long/i,
	/input.*too long/i,
	/exceeded.*context/i,
	/context.*overflow/i,
]

export function classifyErrorText(text: string | undefined): FailureTextClass {
	if (!text) return 'terminal'
	if (OVERFLOW_PATTERNS.some(pattern => pattern.test(text))) return 'overflow'
	if (!RETRYABLE_PATTERNS.some(pattern => pattern.test(text)))
		return 'terminal'
	return 'retryable'
}
