import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
	activeExclusions,
	fallbackCandidates,
	modelReference,
	parseModelReference,
	recordExclusion,
} from '../extensions/model-fallback/chain.ts'
import {
	defaultConfig,
	loadConfig,
	parseConfig,
	saveConfig,
} from '../extensions/model-fallback/config.ts'
import { FallbackSession } from '../extensions/model-fallback/fallback-session.ts'
import { formatFallbackStatus } from '../extensions/model-fallback/picker.ts'
import {
	classifyErrorText,
	classifyStatus,
} from '../extensions/model-fallback/taxonomy.ts'

import type { Exclusions } from '../extensions/model-fallback/chain.ts'
import type { ModelFallbackConfig } from '../extensions/model-fallback/config.ts'
import type { RunEndReport } from '../extensions/model-fallback/fallback-session.ts'

const CHAIN = ['inco/glm', 'openrouter/glm', 'deepseek/flash']

const EXPECTED_DEFAULTS = {
	autoFallback: true,
	restoreOnSuccess: true,
	fastFailover: true,
	exclusionTtlMs: 300_000,
	chain: [],
}

function tempDir(t: test.TestContext): string {
	const dir = mkdtempSync(join(tmpdir(), 'model-fallback-'))
	t.after(() => rmSync(dir, { recursive: true, force: true }))
	return dir
}

/** The clock the session tests inject; the failover code never reads the time. */
const NOW = 1_000_000

/** A session on CHAIN, with the toggles a test needs overridden. */
function sessionWith(
	overrides: Partial<ModelFallbackConfig> = {},
): FallbackSession {
	return new FallbackSession({
		...defaultConfig(),
		chain: CHAIN,
		...overrides,
	})
}

/** pi reported an aborted run (a user escape, or this extension's own abort). */
function aborted(): RunEndReport {
	return { stopReason: 'aborted', errorText: undefined }
}

/** pi reported a run whose model answered everything it was asked. */
function completed(): RunEndReport {
	return { stopReason: 'stop', errorText: undefined }
}

function failed(errorText: string): RunEndReport {
	return { stopReason: 'error', errorText }
}

test('a 5xx answer marks the provider as unhealthy', () => {
	assert.equal(classifyStatus(500), 'failover-fast')
	assert.equal(classifyStatus(502), 'failover-fast')
	assert.equal(classifyStatus(599), 'failover-fast')
})

test('a rate limit, timeout or missing model may recover on its own', () => {
	assert.equal(classifyStatus(429), 'failover-slow')
	assert.equal(classifyStatus(408), 'failover-slow')
	assert.equal(classifyStatus(404), 'failover-slow')
})

test('a successful or client-status answer is not a model failure', () => {
	assert.equal(classifyStatus(200), 'none')
	assert.equal(classifyStatus(301), 'none')
	assert.equal(classifyStatus(400), 'none')
	assert.equal(classifyStatus(600), 'none')
})

test('provider failures that another model can serve are retryable', () => {
	assert.equal(classifyErrorText('502 Bad Gateway'), 'retryable')
	assert.equal(
		classifyErrorText('Provider returned 429 Too Many Requests'),
		'retryable',
	)
	assert.equal(
		classifyErrorText('stream ended without finish_reason'),
		'retryable',
	)
	assert.equal(
		classifyErrorText('model z-ai/glm-5.3-flash not found'),
		'retryable',
	)
	assert.equal(classifyErrorText('socket hang up'), 'retryable')
})

test('a context overflow is never a failover', () => {
	assert.equal(
		classifyErrorText('maximum context length exceeded'),
		'overflow',
	)
	assert.equal(
		classifyErrorText(
			'rate limit hit: context length exceeded for this model',
		),
		'overflow',
	)
})

test('an unclassified or request-shaped error is terminal', () => {
	assert.equal(
		classifyErrorText(
			'invalid_request_error: unsupported parameter temperature',
		),
		'terminal',
	)
	assert.equal(classifyErrorText(''), 'terminal')
	assert.equal(classifyErrorText(undefined), 'terminal')
})

test('failing on the first chain model moves to the next one', () => {
	assert.deepEqual(fallbackCandidates('inco/glm', CHAIN, new Set()), [
		'openrouter/glm',
		'deepseek/flash',
	])
})

test('failing mid-chain continues downward then wraps to the top', () => {
	assert.deepEqual(fallbackCandidates('openrouter/glm', CHAIN, new Set()), [
		'deepseek/flash',
		'inco/glm',
	])
})

test('a failure on a model outside the chain falls back from the top', () => {
	assert.deepEqual(
		fallbackCandidates('nebius/zai-org/GLM-5.3-Flash', CHAIN, new Set()),
		CHAIN,
	)
})

test('an unknown failed model starts from the top of the chain', () => {
	assert.deepEqual(fallbackCandidates(undefined, CHAIN, new Set()), CHAIN)
})

test('the failed model is never its own fallback', () => {
	assert.deepEqual(
		fallbackCandidates('inco/glm', ['inco/glm'], new Set()),
		[],
	)
})

test('a cooling-down model is skipped as a candidate', () => {
	assert.deepEqual(
		fallbackCandidates('inco/glm', CHAIN, new Set(['openrouter/glm'])),
		['deepseek/flash'],
	)
})

test('a failed model stays excluded until its ttl expires', () => {
	const exclusions: Exclusions = new Map()
	recordExclusion(exclusions, 'inco/glm', 1_000, 5_000)
	assert.equal(activeExclusions(exclusions, 1_000).has('inco/glm'), true)
	assert.equal(activeExclusions(exclusions, 5_999).has('inco/glm'), true)
	assert.equal(activeExclusions(exclusions, 6_000).has('inco/glm'), false)
	assert.equal(
		activeExclusions(exclusions, 1_000).has('openrouter/glm'),
		false,
	)
})

test('an unknown model cannot be excluded', () => {
	const exclusions: Exclusions = new Map()
	recordExclusion(exclusions, undefined, 1_000, 5_000)
	assert.equal(exclusions.size, 0)
})

test('an empty config yields the defaults', () => {
	assert.deepEqual(parseConfig({}), EXPECTED_DEFAULTS)
})

test('a non-boolean toggle is rejected', () => {
	assert.throws(
		() => parseConfig({ autoFallback: 'yes' }),
		/autoFallback must be boolean/,
	)
	assert.throws(
		() => parseConfig({ fastFailover: 1 }),
		/fastFailover must be boolean/,
	)
})

test('a chain entry must carry a provider and a model', () => {
	assert.throws(
		() => parseConfig({ chain: ['glm'] }),
		/chain\/0 must match pattern/,
	)
	assert.throws(
		() => parseConfig({ chain: ['openrouter/'] }),
		/chain\/0 must match pattern/,
	)
	assert.throws(() => parseConfig({ chain: [42] }), /chain\/0 must be string/)
	assert.throws(
		() => parseConfig({ chain: 'openrouter/glm' }),
		/chain must be array/,
	)
})

test('a duplicated chain entry is rejected', () => {
	assert.throws(
		() => parseConfig({ chain: ['inco/glm', 'inco/glm'] }),
		/chain must not have duplicate items/,
	)
})

test('a cooldown shorter than one second is rejected', () => {
	assert.throws(
		() => parseConfig({ exclusionTtlMs: 999 }),
		/exclusionTtlMs must be >= 1000/,
	)
})

test('a complete config is parsed as written', () => {
	assert.deepEqual(
		parseConfig({
			autoFallback: false,
			restoreOnSuccess: false,
			fastFailover: false,
			exclusionTtlMs: 60_000,
			chain: ['openrouter/glm'],
		}),
		{
			autoFallback: false,
			restoreOnSuccess: false,
			fastFailover: false,
			exclusionTtlMs: 60_000,
			chain: ['openrouter/glm'],
		},
	)
})

test('saving then loading a config round-trips it', t => {
	const path = join(tempDir(t), 'config.json')
	const config = {
		...defaultConfig(),
		exclusionTtlMs: 60_000,
		chain: ['openrouter/z-ai/glm-5.3-flash', 'deepseek/deepseek-v4-flash'],
	}
	saveConfig(path, config)
	assert.deepEqual(loadConfig(path), config)
})

test('a missing config file loads the defaults', t => {
	assert.deepEqual(
		loadConfig(join(tempDir(t), 'absent.json')),
		EXPECTED_DEFAULTS,
	)
})

test('a malformed config file reports its own path', t => {
	const path = join(tempDir(t), 'config.json')
	writeFileSync(path, '{ "autoFallback": ')
	assert.throws(() => loadConfig(path), new RegExp(`${path}:`))
})

test('a model reference keeps a nested model id intact', () => {
	const reference = modelReference({
		provider: 'openrouter',
		id: 'z-ai/glm-5.3-flash',
	})
	assert.equal(reference, 'openrouter/z-ai/glm-5.3-flash')
	assert.deepEqual(parseModelReference(reference), {
		provider: 'openrouter',
		modelId: 'z-ai/glm-5.3-flash',
	})
})

test('a reference with an empty provider or model is rejected', () => {
	assert.equal(parseModelReference('glm'), undefined)
	assert.equal(parseModelReference('/glm'), undefined)
	assert.equal(parseModelReference('openrouter/'), undefined)
})

test('the status reports the chain and the remaining cooldowns', () => {
	const exclusions = new Map([['inco/glm', 31_000]])
	const status = formatFallbackStatus(
		{ ...defaultConfig(), chain: ['openrouter/glm'] },
		'openrouter/glm',
		exclusions,
		1_000,
	)
	assert.match(status, /Chain: openrouter\/glm/)
	assert.match(status, /Main model: openrouter\/glm/)
	assert.match(status, /Cooling down: inco\/glm \(30s\)/)
})

test('the status points at /fallback when the chain is empty', () => {
	const status = formatFallbackStatus(
		defaultConfig(),
		undefined,
		new Map(),
		0,
	)
	assert.match(status, /empty - run \/fallback/)
	assert.equal(status.includes('Cooling down'), false)
})

test('a retryable provider error is the failure a settled run fails over from', () => {
	const session = sessionWith()
	session.noteRunEnd(failed('upstream timeout'), 'inco/glm', NOW)
	assert.deepEqual(session.settle().failure, {
		model: 'inco/glm',
		reason: 'upstream timeout',
	})
})

test('a failed model is cooled down for the configured TTL', () => {
	const session = sessionWith()
	session.noteRunEnd(failed('HTTP 502'), 'inco/glm', NOW)
	assert.equal(session.isCoolingDown('inco/glm', NOW), true)
	assert.equal(
		session.isCoolingDown(
			'inco/glm',
			NOW + EXPECTED_DEFAULTS.exclusionTtlMs,
		),
		false,
	)
})

test('a cooling model is left out of the chain until its cooldown expires', () => {
	const session = sessionWith()
	session.coolDown('openrouter/glm', NOW)
	assert.deepEqual(session.candidatesAfter('inco/glm', NOW), [
		'deepseek/flash',
	])
	assert.deepEqual(
		session.candidatesAfter(
			'inco/glm',
			NOW + EXPECTED_DEFAULTS.exclusionTtlMs,
		),
		['openrouter/glm', 'deepseek/flash'],
	)
})

test('a context overflow never moves the model', () => {
	const session = sessionWith()
	session.noteRunEnd(
		failed('maximum context length exceeded'),
		'inco/glm',
		NOW,
	)
	assert.equal(session.settle().failure, undefined)
	assert.equal(session.isCoolingDown('inco/glm', NOW), false)
})

test('an error no other model can serve does not move the model either', () => {
	const session = sessionWith()
	session.noteRunEnd(failed('invalid tool schema'), 'inco/glm', NOW)
	assert.equal(session.settle().failure, undefined)
})

test('auto-fallback off keeps a failure from moving the model', () => {
	const session = sessionWith({ autoFallback: false })
	session.noteRunEnd(failed('HTTP 502'), 'inco/glm', NOW)
	assert.equal(session.settle().failure, undefined)
})

test('a clean run returns the session to the model its streak started from', () => {
	const session = sessionWith()
	session.markFallbackActive('inco/glm')
	session.noteRunEnd(completed(), 'openrouter/glm', NOW)
	assert.equal(session.settle().shouldRestore, true)
	assert.equal(session.restoreModel(), 'inco/glm')
})

test('a clean run on no fallback asks for no restore', () => {
	const session = sessionWith()
	session.noteRunEnd(completed(), 'inco/glm', NOW)
	assert.equal(session.settle().shouldRestore, false)
})

test('restore-on-success off keeps a clean run on the fallback', () => {
	const session = sessionWith({ restoreOnSuccess: false })
	session.markFallbackActive('inco/glm')
	session.noteRunEnd(completed(), 'openrouter/glm', NOW)
	assert.equal(session.settle().shouldRestore, false)
})

test('the first failover of a streak is the model a restore returns to', () => {
	const session = sessionWith()
	session.markFallbackActive('inco/glm')
	session.markFallbackActive('openrouter/glm')
	assert.equal(session.restoreModel(), 'inco/glm')
})

test("this extension's own abort keeps the failure sighting", () => {
	const session = sessionWith()
	session.startRun()
	session.beginCall()
	assert.equal(session.noteResponse(503, 'inco/glm', false), true)
	session.noteRunEnd(aborted(), 'inco/glm', NOW)
	assert.deepEqual(session.settle().failure, {
		model: 'inco/glm',
		reason: 'HTTP 503',
	})
})

test('a user abort clears the failure sighting', () => {
	const session = sessionWith()
	session.startRun()
	session.beginCall()
	assert.equal(session.noteResponse(429, 'inco/glm', false), false)
	session.noteRunEnd(aborted(), 'inco/glm', NOW)
	assert.equal(session.settle().failure, undefined)
})

test('the fast failover aborts the first response of a run only', () => {
	const session = sessionWith()
	session.startRun()
	session.beginCall()
	assert.equal(session.noteResponse(503, 'inco/glm', false), true)
	session.beginCall()
	assert.equal(session.noteResponse(503, 'inco/glm', false), false)
})

test('a running turn is aborted only while there is something to interrupt', () => {
	const session = sessionWith()
	session.startRun()
	session.beginCall()
	assert.equal(session.noteResponse(503, 'inco/glm', true), false)
})

test('a provider response read while compacting is not a failure', () => {
	const session = sessionWith()
	session.enterCompaction()
	session.beginCall()
	assert.equal(session.noteResponse(503, 'inco/glm', false), false)
	session.leaveCompaction()
	session.startRun()
	session.beginCall()
	assert.equal(session.noteResponse(503, 'inco/glm', false), true)
})

test("a switch of this extension's own is consumed, a user switch is not", () => {
	const session = sessionWith()
	session.trackSwitch('openrouter/glm')
	assert.equal(session.consumeSwitch('openrouter/glm'), true)
	assert.equal(session.consumeSwitch('openrouter/glm'), false)
	assert.equal(session.consumeSwitch('deepseek/flash'), false)
})

test('a switch pi refused cannot swallow a later user switch', () => {
	const session = sessionWith()
	session.trackSwitch('openrouter/glm')
	session.forgetSwitch('openrouter/glm')
	assert.equal(session.consumeSwitch('openrouter/glm'), false)
})

test('a new session forgets the failures and switches of the previous one', () => {
	const session = sessionWith()
	session.markFallbackActive('inco/glm')
	session.trackSwitch('openrouter/glm')
	session.noteRunEnd(failed('HTTP 502'), 'inco/glm', NOW)
	session.startSession(session.currentConfig())
	const decision = session.settle()
	assert.equal(decision.failure, undefined)
	assert.equal(decision.shouldRestore, false)
	assert.equal(session.restoreModel(), undefined)
	assert.equal(session.consumeSwitch('openrouter/glm'), false)
	assert.equal(session.isCoolingDown('inco/glm', NOW), false)
})
