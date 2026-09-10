import assert from 'node:assert/strict'
import test from 'node:test'

import { stripTerminalSequences } from '@earendil-works/pi-tui'

import {
	currencySymbol,
	deepseekBalanceUsd,
	parseDeepseekBalance,
} from '../extensions/footer/quota-deepseek.ts'
import { quotaStrip } from '../extensions/footer/render-quota.ts'

/** Verbatim shape of GET https://api.deepseek.com/user/balance. */
const BALANCE_RESPONSE = {
	is_available: true,
	balance_infos: [
		{
			currency: 'CNY',
			total_balance: '110.00',
			granted_balance: '10.00',
			topped_up_balance: '100.00',
		},
	],
}

void test('parses the DeepSeek balance with decimal strings', () => {
	assert.deepEqual(parseDeepseekBalance(BALANCE_RESPONSE), {
		balance: 110,
		currency: 'CNY',
	})
})

void test('defaults the currency and floors a negative balance', () => {
	assert.deepEqual(
		parseDeepseekBalance({ balance_infos: [{ total_balance: '-4.5' }] }),
		{ balance: 0, currency: 'USD' },
	)
})

void test('rejects payloads without a usable balance row', () => {
	for (const payload of [
		undefined,
		null,
		'',
		{},
		{ balance_infos: [] },
		{ balance_infos: 'nope' },
		{ balance_infos: [{ total_balance: 'not a number' }] },
	]) {
		assert.equal(
			parseDeepseekBalance(payload),
			undefined,
			`payload ${JSON.stringify(payload)} has no balance`,
		)
	}
})

void test('labels known currencies and prints unknown codes verbatim', () => {
	assert.equal(currencySymbol('CNY'), '\u00a5')
	assert.equal(currencySymbol('usd'), '$')
	assert.equal(currencySymbol('EUR'), 'EUR ')
})

void test('only the colour ramp converts yuan to dollars', () => {
	assert.equal(deepseekBalanceUsd({ balance: 70, currency: 'CNY' }), 10)
	assert.equal(deepseekBalanceUsd({ balance: 70, currency: 'USD' }), 70)
})

void test('the strip shows the DeepSeek balance as the active provider', () => {
	const line = stripTerminalSequences(
		quotaStrip({ deepseek: { balance: 110, currency: 'CNY' } }, 'deepseek'),
	)

	assert.ok(line.includes('deepseek'), line)
	assert.ok(line.includes('\u00a5110.00'), line)
	assert.ok(!line.includes('openrouter'), line)
})

void test('the strip names the missing data instead of borrowing quotas', () => {
	const withoutData = stripTerminalSequences(quotaStrip({}, 'deepseek'))
	const foreignQuota = stripTerminalSequences(
		quotaStrip({ deepseek: { balance: 5, currency: 'USD' } }, 'inco'),
	)

	assert.ok(withoutData.includes('no quota data'), withoutData)
	assert.ok(foreignQuota.includes('no quota data'), foreignQuota)
	assert.ok(!foreignQuota.includes('deepseek'), foreignQuota)
})
