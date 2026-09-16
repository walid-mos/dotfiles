import assert from 'node:assert/strict'
import test from 'node:test'

import { stripTerminalSequences } from '@earendil-works/pi-tui'

import {
	nebiusCreditUsd,
	nebiusQuota,
	parseNebiusBalance,
	parseNebiusTrial,
	trialRemaining,
} from '../extensions/footer/quota-nebius.ts'
import { quotaStrip } from '../extensions/footer/render-quota.ts'

/** Verbatim `customers/getBalance` answer for contract-e00bdo63pxi0u8n310nug. */
const BALANCE_RESPONSE = {
	balance: '30.00',
	ledgerId: 'ledger-e00ijsa1cumren6t6f80b',
	contractId: 'contract-e00bdo63pxi0u8n310nug',
}

/** Verbatim `billingActs/getCurrentTrial` answer, trimmed to its two blocks. */
const TRIAL_RESPONSE = {
	metadata: { id: 'trial-e00q3rb8b5kzi8caeu55g' },
	spec: {
		freeConsumptionStartedAt: { seconds: '1789538400', nanos: 0 },
		netConsumptionLimit: '1.00',
		durationLimitFinishedAt: { seconds: '1792130400', nanos: 0 },
		limitExceeded: false,
		switchedToPaid: true,
	},
	status: {
		state: 2,
		durationLimitStatus: 1,
		netConsumptionLimitStatus: 1,
		netConsumptionSpent: '0.00',
		daysLeft: '29',
		daysLimit: '30',
	},
}

void test('parses the contract balance with decimal strings', () => {
	assert.equal(parseNebiusBalance(BALANCE_RESPONSE), 30)
	assert.equal(parseNebiusBalance({ balance: '-4.5' }), 0)
})

void test('rejects balance payloads without a numeric balance', () => {
	for (const payload of [
		undefined,
		null,
		'',
		{},
		{ balance: 'not a number' },
		{ balance: null },
	]) {
		assert.equal(
			parseNebiusBalance(payload),
			undefined,
			`payload ${JSON.stringify(payload)} has no balance`,
		)
	}
})

void test('parses the trial window and what it has left', () => {
	const trial = parseNebiusTrial(TRIAL_RESPONSE)

	assert.deepEqual(trial, {
		limit: 1,
		spent: 0,
		daysLeft: 29,
		daysLimit: 30,
		expired: false,
	})
	assert.equal(trial && trialRemaining(trial), 1)
})

void test('a trial ends on a spent grant or a closed window', () => {
	const spent = parseNebiusTrial({
		...TRIAL_RESPONSE,
		spec: { ...TRIAL_RESPONSE.spec, limitExceeded: true },
	})
	const closed = parseNebiusTrial({
		...TRIAL_RESPONSE,
		status: { ...TRIAL_RESPONSE.status, daysLeft: '0' },
	})

	assert.equal(spent?.expired, true)
	assert.equal(closed?.expired, true)
})

void test('rejects trial payloads without a grant', () => {
	for (const payload of [
		undefined,
		null,
		{},
		{ spec: {}, status: {} },
		{ spec: { netConsumptionLimit: 'x' }, status: {} },
	]) {
		assert.equal(
			parseNebiusTrial(payload),
			undefined,
			`payload ${JSON.stringify(payload)} has no trial`,
		)
	}
})

void test('a trial without a day count still reports what it spent', () => {
	const trial = parseNebiusTrial({
		spec: { netConsumptionLimit: '50.00' },
		status: { netConsumptionSpent: '20.00' },
	})

	// Unknown days stay unknown (NaN), and an unspent grant keeps it running
	assert.equal(trial?.limit, 50)
	assert.equal(trial?.spent, 20)
	assert.ok(Number.isNaN(trial?.daysLeft ?? 0))
	assert.equal(trial?.expired, false)
	assert.equal(trial && trialRemaining(trial), 30)

	const spent = parseNebiusTrial({
		spec: { netConsumptionLimit: '50.00' },
		status: { netConsumptionSpent: '50.00' },
	})
	assert.equal(spent?.expired, true)
	assert.equal(spent && trialRemaining(spent), 0)
})

void test('credit for the colour ramp counts a live trial only', () => {
	const live = nebiusQuota(BALANCE_RESPONSE, TRIAL_RESPONSE)
	const spent = nebiusQuota(BALANCE_RESPONSE, {
		...TRIAL_RESPONSE,
		spec: { ...TRIAL_RESPONSE.spec, limitExceeded: true },
	})

	assert.equal(live && nebiusCreditUsd(live), 31)
	assert.equal(spent && nebiusCreditUsd(spent), 30)
})

void test('the balance alone is a usable quota', () => {
	assert.deepEqual(nebiusQuota(BALANCE_RESPONSE, undefined), {
		balance: 30,
		currency: 'USD',
	})
	assert.equal(nebiusQuota(undefined, TRIAL_RESPONSE), undefined)
})

void test('the strip shows the Nebius credits and its trial', () => {
	const quota = nebiusQuota(BALANCE_RESPONSE, TRIAL_RESPONSE)
	assert.ok(quota)
	const line = stripTerminalSequences(quotaStrip({ nebius: quota }, 'nebius'))

	assert.ok(line.includes('nebius'), line)
	assert.ok(line.includes('$30.00'), line)
	assert.ok(line.includes('essai'), line)
	assert.ok(line.includes('$1.00'), line)
	assert.ok(line.includes('29 j'), line)
	assert.ok(!line.includes('deepseek'), line)
})

void test('compact mode keeps the grant and drops the day count', () => {
	const quota = nebiusQuota(BALANCE_RESPONSE, TRIAL_RESPONSE)
	assert.ok(quota)
	const line = stripTerminalSequences(
		quotaStrip({ nebius: quota }, 'nebius', { compact: true }),
	)

	assert.ok(line.includes('$1.00'), line)
	assert.ok(!line.includes('29 j'), line)
})

void test('an expired trial leaves only the balance', () => {
	const quota = nebiusQuota(BALANCE_RESPONSE, {
		...TRIAL_RESPONSE,
		status: { ...TRIAL_RESPONSE.status, daysLeft: '0' },
	})
	assert.ok(quota)
	const line = stripTerminalSequences(quotaStrip({ nebius: quota }, 'nebius'))

	assert.ok(line.includes('$30.00'), line)
	assert.ok(!line.includes('essai'), line)
})

void test('a logged-out machine names the missing data', () => {
	const missing = stripTerminalSequences(quotaStrip({}, 'nebius'))
	const foreign = stripTerminalSequences(
		quotaStrip({ nebius: { balance: 30, currency: 'USD' } }, 'inco'),
	)

	assert.ok(missing.includes('no quota data'), missing)
	assert.ok(foreign.includes('no quota data'), foreign)
	assert.ok(!foreign.includes('nebius'), foreign)
})
