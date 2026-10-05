import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fixture } from './fixture.ts'

test('installed Brave renders, fills, selects by label, captures responsive PNG and collects errors', async context => {
	const { browser, url } = await fixture(context, { SHOT_FORMAT: 'png' })
	const description = await browser.run(() =>
		browser.open({ url, wait_for: '#save' }, '/tmp'),
	)
	assert.match(description, /Frontend Check fixture/)
	await browser.run(() =>
		browser.act({ action: 'type', target: '#name', text: 'Walid' }),
	)
	await browser.run(() => browser.act({ action: 'click', target: '#save' }))
	assert.equal(
		await browser.run(() =>
			browser.evaluate("document.querySelector('#saved').textContent"),
		),
		'"Walid"',
	)
	await browser.run(() =>
		browser.act({ action: 'type', target: '#name', text: '' }),
	)
	assert.equal(
		await browser.run(() =>
			browser.evaluate("document.querySelector('#name').value"),
		),
		'""',
	)
	await browser.run(() =>
		browser.act({
			action: 'select',
			target: '#choice',
			text: 'Second label',
		}),
	)
	assert.equal(
		await browser.run(() =>
			browser.evaluate("document.querySelector('#choice').value"),
		),
		'"two"',
	)
	const shot = await browser.run(() =>
		browser.screenshot({ width: 375, height: 812 }),
	)
	const image = Buffer.from(shot.data, 'base64')
	assert.equal(shot.mimeType, 'image/png')
	assert.equal(image.subarray(1, 4).toString(), 'PNG')
	assert.equal(image.readUInt32BE(16), 375)
	assert.equal(image.readUInt32BE(20), 812)
	assert.equal(await browser.run(() => browser.evaluate('innerWidth')), '375')
	await browser.run(() =>
		browser.evaluate(
			"Promise.all([fetch('/missing'), fetch('/disconnect').catch(()=>{}), Promise.resolve().then(()=>console.error('fixture error'))])",
		),
	)
	const log = await browser.run(async () => browser.console())
	assert.match(log, /fixture warning/)
	assert.match(log, /fixture error/)
	assert.match(log, /HTTP 404/)
	assert.match(log, /requestfailed/)
})

test('runs ordered actions in one shared-session batch', async context => {
	const { browser, url } = await fixture(context)
	await browser.run(() => browser.open({ url }, '/tmp'))
	const batchDescription = await browser.run(() =>
		browser.actMany([
			{
				id: 'enter-name',
				action: 'type',
				target: '#name',
				text: 'Walid',
			},
			{ id: 'save-name', action: 'click', target: '#save' },
			{
				id: 'choose-second',
				action: 'select',
				target: '#choice',
				text: 'Second label',
			},
		]),
	)
	assert.match(
		batchDescription,
		/Completed 3 frontend actions: enter-name, save-name, choose-second/,
	)
	assert.equal(
		await browser.run(() =>
			browser.evaluate(
				"[document.querySelector('#saved').textContent, document.querySelector('#choice').value]",
			),
		),
		'[\n  "Walid",\n  "two"\n]',
	)
})

test('ambiguous selectors fail without clicking; popup becomes the current page', async context => {
	const { browser, url } = await fixture(context)
	await browser.run(() => browser.open({ url }, '/tmp'))
	await assert.rejects(
		browser.run(() =>
			browser.act({ action: 'click', target: '.ambiguous' }),
		),
		/strict mode violation/,
	)
	await browser.run(() =>
		browser.act({
			action: 'click',
			target: '#popup',
			popup: true,
			wait_for: '#popup-ready',
		}),
	)
	assert.equal(
		await browser.run(() => browser.evaluate('document.title')),
		'"Popup fixture"',
	)
	const shot = await browser.run(() => browser.screenshot({ selector: 'h1' }))
	assert.equal(shot.mimeType, 'image/jpeg')
	assert.equal(
		Buffer.from(shot.data, 'base64').subarray(0, 2).toString('hex'),
		'ffd8',
	)
})

test('cancels an unresolved evaluation, closes Brave and allows a fresh open', async context => {
	const { browser, url, evaluationStarted } = await fixture(context)
	await browser.run(() => browser.open({ url }, '/tmp'))
	const cancellation = new AbortController()
	const evaluating = browser.run(
		() =>
			browser.evaluate(
				"fetch('/evaluation-started').then(()=>new Promise(()=>{}))",
			),
		cancellation.signal,
	)
	const rejected = assert.rejects(evaluating, /cancel-test/)
	await evaluationStarted
	cancellation.abort(new Error('cancel-test'))
	await rejected
	assert.match(browser.status(), /Browser: closed/)
	await browser.run(() => browser.open({ url }, '/tmp'))
	assert.match(browser.status(), /Browser: running/)
})

test('an action timeout preserves the authenticated browser session', async context => {
	const { browser, url } = await fixture(context, {
		ACTION_TIMEOUT_MS: 100,
		NAV_TIMEOUT_MS: 1000,
	})
	await browser.run(() => browser.open({ url }, '/tmp'))
	await assert.rejects(
		browser.run(() =>
			browser.act({ action: 'click', target: '#missing-control' }),
		),
		/timeout/i,
	)
	assert.match(browser.status(), /Browser: running/)
	assert.equal(
		await browser.run(() => browser.evaluate('document.title')),
		'"Frontend Check fixture"',
	)
})

test('navigation timeout is a failure, not a successful partial-page report', async context => {
	const { browser, url } = await fixture(context, { NAV_TIMEOUT_MS: 5000 })
	await browser.run(() => browser.open({ url }, '/tmp'))
	await assert.rejects(
		browser.run(() => browser.open({ url: `${url}/never` }, '/tmp')),
		/timed out|timeout/i,
	)
	assert.match(browser.status(), /Browser: closed/)
})
