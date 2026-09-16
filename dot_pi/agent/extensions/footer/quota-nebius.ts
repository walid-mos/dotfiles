// Nebius credits: the contract's ledger balance plus the free trial still
// running on it. Pure - payloads in, numbers out; the network lives in
// nebius-session.ts.
//
// Shapes come from the console's own billing gateway (captured payloads are
// the test fixtures): `customers/getBalance` answers `{ balance: "30.00" }`,
// `billingActs/getCurrentTrial` answers a Nebius resource whose `spec` holds
// `netConsumptionLimit` and whose `status` holds `netConsumptionSpent`,
// `daysLeft` and `daysLimit`. Amounts are decimal strings.

import { finiteNumber, isRecord } from './json.ts'

/**
 * Free trial window: the grant, what it burned, and its remaining days.
 * Days are NaN when the payload omits them (the json.ts house convention).
 */
export type NebiusTrial = {
	limit: number
	spent: number
	daysLeft: number
	daysLimit: number
	expired: boolean
}

export type NebiusQuota = {
	balance: number
	currency: string
	trial?: NebiusTrial
}

/** The console prints dollars; the payload carries no currency field. */
const DEFAULT_CURRENCY = 'USD'

/**
 * Ledger balance of the billing contract, in the currency it is held in.
 * Negative balances are clamped: the ramp reads credit, not debt.
 */
export function parseNebiusBalance(payload: unknown): number | undefined {
	if (!isRecord(payload)) return undefined
	const balance = finiteNumber(payload.balance)
	if (!Number.isFinite(balance)) return undefined
	return Math.max(0, balance)
}

/**
 * Running trial. `expired` merges every way it ends - the grant is spent, the
 * window closed, or the server flagged the limit - so rendering keeps a single
 * condition. A payload that omits the day count is not treated as ended: the
 * remaining grant decides.
 */
export function parseNebiusTrial(payload: unknown): NebiusTrial | undefined {
	if (!isRecord(payload)) return undefined
	const { spec, status } = payload
	if (!isRecord(spec) || !isRecord(status)) return undefined
	const limit = finiteNumber(spec.netConsumptionLimit)
	if (!Number.isFinite(limit)) return undefined
	const spent = Math.max(0, finiteNumber(status.netConsumptionSpent) || 0)
	const daysLeft = finiteNumber(status.daysLeft)
	const daysLimit = finiteNumber(status.daysLimit)
	const ranOutOfDays = Number.isFinite(daysLeft) && daysLeft <= 0
	const ranOutOfGrant = limit - spent <= 0
	return {
		limit,
		spent,
		daysLeft,
		daysLimit,
		expired: spec.limitExceeded === true || ranOutOfDays || ranOutOfGrant,
	}
}

/** Unspent credit of a trial window. */
export function trialRemaining(trial: NebiusTrial): number {
	return Math.max(0, trial.limit - trial.spent)
}

/** Credit the account can still burn, for the balance colour ramp only. */
export function nebiusCreditUsd(quota: NebiusQuota): number {
	const liveTrial =
		quota.trial && !quota.trial.expired ? quota.trial : undefined
	return quota.balance + (liveTrial ? trialRemaining(liveTrial) : 0)
}

/** Assemble the quota from the two gateway payloads (either may be absent). */
export function nebiusQuota(
	balancePayload: unknown,
	trialPayload: unknown,
): NebiusQuota | undefined {
	const balance = parseNebiusBalance(balancePayload)
	if (typeof balance !== 'number') return undefined
	const trial = parseNebiusTrial(trialPayload)
	const quota: NebiusQuota = { balance, currency: DEFAULT_CURRENCY }
	if (trial) quota.trial = trial
	return quota
}
