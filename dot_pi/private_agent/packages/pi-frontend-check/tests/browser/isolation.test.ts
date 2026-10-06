import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fixture } from './fixture.ts'

test('separate Pi instances do not share test storage; shutting one down leaves the other alive', async context => {
	const first = await fixture(context)
	const second = await fixture(context)
	await first.browser.run(() =>
		first.browser.open({ url: first.url }, '/tmp'),
	)
	await first.browser.run(() =>
		first.browser.evaluate(
			"localStorage.setItem('private-test', 'first-session')",
		),
	)
	await second.browser.run(() =>
		second.browser.open({ url: first.url }, '/tmp'),
	)
	assert.equal(
		await second.browser.run(() =>
			second.browser.evaluate("localStorage.getItem('private-test')"),
		),
		'null',
	)
	await first.browser.shutdown()
	assert.match(first.browser.status(), /Browser: closed/)
	await assert.rejects(
		first.browser.run(() => first.browser.open({ url: first.url }, '/tmp')),
		/session closed/,
	)
	assert.equal(
		await second.browser.run(() =>
			second.browser.evaluate('document.title'),
		),
		'"Frontend Check fixture"',
	)
})

test('shutdown cancels active evaluation and rejects queued actions', async context => {
	const { browser, url, evaluationStarted } = await fixture(context)
	await browser.run(() => browser.open({ url }, '/tmp'))
	const active = browser.run(() =>
		browser.evaluate(
			"fetch('/evaluation-started').then(()=>new Promise(()=>{}))",
		),
	)
	const rejectedActive = assert.rejects(active, /session closed/)
	await evaluationStarted
	const queued = browser.run(() =>
		browser.actMany(
			[{ id: 'save', action: 'click', target: '#save' }],
			'/tmp',
		),
	)
	const rejectedQueued = assert.rejects(queued, /session closed/)
	await Promise.all([browser.shutdown(), rejectedActive, rejectedQueued])
	assert.match(browser.status(), /Browser: closed/)
})
