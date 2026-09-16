/**
 * The live OpenRouter price list at its own seam: the captured public response
 * parses into per-million rates, a rate the API does not publish stays missing,
 * a -1 sentinel stays unknown, and only explicit zeros with nothing else
 * published read as free.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
	createOpenRouterPricingSource,
	hasPublishedRate,
	isFreeOpenRouterPrice,
	openRouterIdFor,
	parseOpenRouterModels,
} from '../extensions/model-fallback/openrouter-pricing.ts'

import {
	OPENROUTER_MODELS_RESPONSE,
	openRouterFixtureFetch,
} from './openrouter-models-fixture.ts'

import type { OpenRouterModelPrice } from '../extensions/model-fallback/openrouter-pricing.ts'

const TOLERANCE = 1e-9

/** Per-token USD to per-million USD: the one conversion the picker needs. */
function assertRate(actual: number | null, expected: number): void {
	assert.ok(
		actual !== null && Math.abs(actual - expected) < TOLERANCE,
		`expected ~${expected}, received ${actual}`,
	)
}

function capturedPrice(id: string): OpenRouterModelPrice {
	const price = parseOpenRouterModels(OPENROUTER_MODELS_RESPONSE).get(id)
	assert.ok(price, `the fixture has no ${id}`)
	return price
}

test('the captured union-alpha entry is free at explicit zero rates', () => {
	const price = capturedPrice('stealth/union-alpha')

	assert.equal(price.prompt, 0)
	assert.equal(price.completion, 0)
	assert.equal(
		price.cacheRead,
		null,
		'an unpublished cache rate is not a zero',
	)
	assert.equal(price.cacheWrite, null)
	assert.equal(price.hasAdditionalPrice, false)
	assert.equal(hasPublishedRate(price), true)
	assert.equal(isFreeOpenRouterPrice(price), true)
})

test('captured per-token prices convert to per-million rates', () => {
	const price = capturedPrice('qwen/qwen3.8-flash')

	assertRate(price.prompt, 0.15)
	assertRate(price.completion, 0.47)
	assertRate(price.cacheRead, 0.016)
	assertRate(price.cacheWrite, 0.2)
	assert.equal(price.hasAdditionalPrice, false)
	assert.equal(isFreeOpenRouterPrice(price), false)
})

test('the -1 sentinel of a dynamic-price model stays unknown, never free', () => {
	const price = capturedPrice('openrouter/auto')

	assert.equal(price.prompt, null)
	assert.equal(price.completion, null)
	assert.equal(hasPublishedRate(price), false)
	assert.equal(isFreeOpenRouterPrice(price), false)
})

test('a published fee or tier beside zero rates keeps the model non-free', () => {
	// OpenRouter's pricing object can carry per-request/image/search keys and
	// tiered `overrides`; no captured model publishes one beside zero rates.
	const prices = parseOpenRouterModels({
		data: [
			{
				id: 'example/zero-with-request-fee',
				pricing: { prompt: '0', completion: '0', request: '0.01' },
			},
			{
				id: 'example/zero-with-tiers',
				pricing: {
					prompt: '0',
					completion: '0',
					overrides: [
						{ min_prompt_tokens: 272000, prompt: '0.00001' },
					],
				},
			},
		],
	})
	const withFee = prices.get('example/zero-with-request-fee')
	const withTiers = prices.get('example/zero-with-tiers')

	assert.ok(withFee)
	assert.ok(withTiers)
	assert.equal(withFee.hasAdditionalPrice, true)
	assert.equal(isFreeOpenRouterPrice(withFee), false)
	assert.equal(withTiers.hasAdditionalPrice, true)
	assert.equal(isFreeOpenRouterPrice(withTiers), false)
})

test('an unreadable payload yields no prices instead of invented ones', () => {
	assert.equal(parseOpenRouterModels(undefined).size, 0)
	assert.equal(parseOpenRouterModels({ data: 'nope' }).size, 0)
	assert.equal(
		parseOpenRouterModels({ data: [{ name: 'no id' }, { id: '' }] }).size,
		0,
	)
})

test('picker references map to OpenRouter ids exactly', () => {
	assert.equal(
		openRouterIdFor('openrouter/stealth/union-alpha'),
		'stealth/union-alpha',
	)
	assert.equal(openRouterIdFor('inco/glm-5.3-flash'), undefined)
	assert.equal(
		openRouterIdFor('openrouter-beta/stealth/union-alpha'),
		undefined,
	)
})

test('the source reads the list once and serves later refreshes from cache', async () => {
	const fixtureFetch = openRouterFixtureFetch()
	let reads = 0
	const source = createOpenRouterPricingSource(async (url, init) => {
		reads += 1
		return fixtureFetch(url, init)
	})

	const first = await source.refresh()
	const second = await source.refresh()

	assert.equal(reads, 1, 'a second open must not re-read the public list')
	assert.ok(first && first.fetchedAt > 0)
	assert.equal(first, second)
	assert.equal(source.snapshot(), first)
	assert.equal(first.prices.get('stealth/union-alpha')?.prompt, 0)
})

test('an endpoint that answers with an error leaves the list unread', async () => {
	const source = createOpenRouterPricingSource(
		async () => new Response('', { status: 503 }),
	)

	assert.equal(await source.refresh(), undefined)
	assert.equal(source.snapshot(), undefined)
})

test('a fetcher that throws is a failed read, not a crash', async () => {
	const source = createOpenRouterPricingSource(async () => {
		throw new Error('offline')
	})

	assert.equal(await source.refresh(), undefined)
	assert.equal(source.snapshot(), undefined)
})
