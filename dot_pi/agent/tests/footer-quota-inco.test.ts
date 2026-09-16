import assert from 'node:assert/strict'
import test from 'node:test'

import { stripTerminalSequences } from '@earendil-works/pi-tui'

import { parseIncoBalance } from '../extensions/footer/quota-inco.ts'
import { quotaStrip } from '../extensions/footer/render-quota.ts'

/**
 * Verbatim layout props of the console's balance chip, as captured from the
 * `/usage` flight payload (`RSC: 1`).
 */
const FLIGHT_PAYLOAD =
	'["$","$L23",null,{"balance":"$$0.009668","balanceLevel":"ok",' +
	'"isAdmin":false,"workspaceName":"Personal"}]'

/** Same chip as embedded in the rendered HTML: quotes are escaped there. */
const ESCAPED_HTML = `<script>self.__next_f.push([1,"[[\\"$\\",\\"$L23\\",null,{\\"balance\\":\\"$$12.34\\",\\"balanceLevel\\":\\"ok\\"}]]"])</script>`

void test('parses the console balance out of the layout payload', () => {
	assert.deepEqual(parseIncoBalance(FLIGHT_PAYLOAD), {
		balance: 0.009668,
		amount: '$0.009668',
	})
})

void test('flight doubles a leading dollar sign, the render does not', () => {
	assert.equal(parseIncoBalance('{"balance":"$$30.00"}')?.amount, '$30.00')
	assert.equal(parseIncoBalance('{"balance":"$30.00"}')?.amount, '$30.00')
})

void test('reads the balance of the escaped HTML copy', () => {
	assert.deepEqual(parseIncoBalance(ESCAPED_HTML), {
		balance: 12.34,
		amount: '$12.34',
	})
})

void test('refuses an amount format the console never printed', () => {
	// Separated thousands would otherwise read as $5
	assert.equal(parseIncoBalance('{"balance":"$$1,234.56"}'), undefined)
})

void test('rejects pages without a usable balance', () => {
	for (const page of [
		'',
		'<html><body>Sign in</body></html>',
		'{"balanceLevel":"ok","workspaceName":"Personal"}',
		'{"balance":null}',
		'{"balance":"$$"}',
		'{"balance":"not money"}',
		'{"balance":"$$0,0,0,5"}',
	]) {
		assert.equal(
			parseIncoBalance(page),
			undefined,
			`page ${JSON.stringify(page)} has no balance`,
		)
	}
})

void test('the strip shows the Inco credit balance', () => {
	const quota = parseIncoBalance(FLIGHT_PAYLOAD)
	assert.ok(quota)
	const line = stripTerminalSequences(quotaStrip({ inco: quota }, 'inco'))

	assert.ok(line.includes('inco'), line)
	assert.ok(line.includes('$0.009668'), line)
	assert.ok(!line.includes('nebius'), line)
})

void test('another provider never borrows the Inco balance', () => {
	const quota = parseIncoBalance(FLIGHT_PAYLOAD)
	assert.ok(quota)
	const line = stripTerminalSequences(quotaStrip({ inco: quota }, 'deepseek'))

	assert.ok(line.includes('no quota data'), line)
	assert.ok(!line.includes('$0.009668'), line)
})

void test('a console-less machine names the missing data', () => {
	const line = stripTerminalSequences(quotaStrip({}, 'inco'))

	assert.ok(line.includes('inco'), line)
	assert.ok(line.includes('no quota data'), line)
})
