/**
 * model-fallback - what a model costs, as the picker shows it.
 *
 * A row is priced from one of two owned sources: the live public OpenRouter
 * price list (`openrouter-pricing.ts`), authoritative for OpenRouter rows
 * because the catalog's all-zero cost there means the catalog never priced
 * them (`stealth/union-alpha`, `openrouter/auto`) and never "free"; or the
 * catalog rates, which cover every other provider. Only a live reading whose
 * published prices are explicitly zero, with nothing else published, is
 * `Free`. A rate a source does not publish stays missing and prints `-`,
 * never `$0.00`.
 *
 * `model-price-gauge.ts` plots a reading on the gauge and names the blend
 * beside the track, so a reading can be checked by hand.
 */

import {
	hasPublishedRate,
	isFreeOpenRouterPrice,
	openRouterIdFor,
} from './openrouter-pricing.ts'

import type { ModelCost, ModelCostTier } from '@earendil-works/pi-ai'
import type { OpenRouterPricing } from './openrouter-pricing.ts'

/** Every rate the picker prints is per million tokens, like the catalog. */
export const PRICE_UNIT = 'per 1M tokens'

const UNKNOWN_CELL = '-'
const RATE_DECIMALS = 2
const SINGLE_DECIMAL_RATE_CEILING = 10
const THOUSAND_TOKENS = 1_000
const MILLION_TOKENS = 1_000_000
const MS_PER_MINUTE = 60_000
const MINUTES_PER_HOUR = 60

/** Where a row's rates came from: the live list, the catalog, or neither. */
export type PriceSource =
	| 'openrouter'
	| 'catalog'
	| 'openrouter-unpriced'
	| 'unknown'

/** One row's reading: the rates, their source, and what the source left out. */
export interface ModelPrice {
	source: PriceSource
	/** USD per million tokens; `null` is a rate the source did not publish. */
	input: number | null
	cachedInput: number | null
	output: number | null
	/** Every published price is explicitly zero - only the live source proves this. */
	isFree: boolean
	/** A published price outside the three rates (per-request, image, search). */
	hasAdditionalPrice: boolean
	/** When the live list was read; `null` for every other source. */
	fetchedAt: number | null
	/** A catalog tier overriding the rates above an input size, when catalog-priced. */
	tier: ModelCostTier | null
}

export interface PriceCells {
	input: string
	cachedInput: string
	output: string
}

/** A zero catalog rate is missing data, not a free model. */
function hasCatalogPrice(cost: ModelCost): boolean {
	return (
		cost.input > 0 ||
		cost.output > 0 ||
		cost.cacheRead > 0 ||
		cost.cacheWrite > 0
	)
}

/** A reading no source priced: every rate unknown, nothing claimed. */
function unpricedReading(
	source: 'unknown' | 'openrouter-unpriced',
): ModelPrice {
	return {
		source,
		input: null,
		cachedInput: null,
		output: null,
		isFree: false,
		hasAdditionalPrice: false,
		fetchedAt: null,
		tier: null,
	}
}

/** A reading from the live list: the model's own published prices. */
function liveReading(
	reference: string,
	pricing: OpenRouterPricing | undefined,
): ModelPrice | undefined {
	if (!pricing) return undefined
	const id = openRouterIdFor(reference)
	if (!id) return undefined
	const published = pricing.prices.get(id)
	if (!published || !hasPublishedRate(published)) return undefined
	return {
		source: 'openrouter',
		input: published.prompt,
		cachedInput: published.cacheRead,
		output: published.completion,
		isFree: isFreeOpenRouterPrice(published),
		hasAdditionalPrice: published.hasAdditionalPrice,
		fetchedAt: pricing.fetchedAt,
		tier: null,
	}
}

function catalogReading(cost: ModelCost): ModelPrice {
	return {
		source: 'catalog',
		input: cost.input,
		cachedInput: cost.cacheRead,
		output: cost.output,
		isFree: false,
		hasAdditionalPrice: false,
		fetchedAt: null,
		tier: highestTier(cost) ?? null,
	}
}

/**
 * The reading for one picker row: the live OpenRouter price when the list has
 * one with a flat rate, else the catalog rates, else nothing priced.
 */
export function modelPrice(
	reference: string,
	cost: ModelCost,
	pricing: OpenRouterPricing | undefined,
): ModelPrice {
	const live = liveReading(reference, pricing)
	if (live) return live
	if (hasCatalogPrice(cost)) return catalogReading(cost)
	if (openRouterIdFor(reference))
		return unpricedReading('openrouter-unpriced')
	return unpricedReading('unknown')
}

export function formatRate(rate: number): string {
	const decimals = rate >= SINGLE_DECIMAL_RATE_CEILING ? 1 : RATE_DECIMALS
	return `$${rate.toFixed(decimals)}`
}

/** A rate the source published; a missing one prints unknown, not zero. */
function rateCell(rate: number | null): string {
	return rate === null ? UNKNOWN_CELL : formatRate(rate)
}

export function priceCells(price: ModelPrice): PriceCells {
	return {
		input: rateCell(price.input),
		cachedInput: rateCell(price.cachedInput),
		output: rateCell(price.output),
	}
}

/** Request-wide rates that apply above an input size; the highest one wins. */
function highestTier(cost: ModelCost): ModelCostTier | undefined {
	const { tiers } = cost
	if (!tiers?.length) return undefined
	return tiers.reduce((best, tier) =>
		tier.inputTokensAbove > best.inputTokensAbove ? tier : best,
	)
}

function formatInputThreshold(tokens: number): string {
	if (tokens < MILLION_TOKENS)
		return `${Math.round(tokens / THOUSAND_TOKENS)}K`
	const millions = (tokens / MILLION_TOKENS)
		.toFixed(RATE_DECIMALS)
		.replace(/\.?0+$/u, '')
	return `${millions}M`
}

/** The tier that overrides the printed rates above an input size. */
function tierText(tier: ModelCostTier): string {
	return `above ${formatInputThreshold(tier.inputTokensAbove)} input: ${formatRate(tier.input)} in / ${formatRate(tier.output)} out`
}

function formatAge(fetchedAt: number, now: number): string {
	const minutes = Math.floor(Math.max(0, now - fetchedAt) / MS_PER_MINUTE)
	if (minutes < 1) return 'just now'
	if (minutes < MINUTES_PER_HOUR) return `${minutes}m ago`
	return `${Math.floor(minutes / MINUTES_PER_HOUR)}h ago`
}

const UNKNOWN_NOTE =
	'no catalog price - subscription plan or unpriced model, not proof of a free request'
const OPENROUTER_UNKNOWN_NOTE =
	'no live OpenRouter price and no catalog price - not proof of a free request'

/** One line naming the reading's source, its freshness and any extra prices. */
export function priceNote(price: ModelPrice, now: number): string {
	if (price.source === 'unknown') return UNKNOWN_NOTE
	if (price.source === 'openrouter-unpriced') return OPENROUTER_UNKNOWN_NOTE
	if (price.source === 'catalog') {
		const tier = price.tier ? tierText(price.tier) : undefined
		return tier ? `catalog rates; ${tier}` : 'catalog rates'
	}
	const freshness = `fetched ${formatAge(price.fetchedAt ?? now, now)}`
	if (price.isFree)
		return `Free - every price OpenRouter publishes is $0.00 (${freshness})`
	const extras = price.hasAdditionalPrice
		? ' plus additional published prices'
		: ''
	return `live OpenRouter rates${extras} (${freshness})`
}
