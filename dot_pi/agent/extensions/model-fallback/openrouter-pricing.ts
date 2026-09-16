/**
 * model-fallback - OpenRouter's public price list, the picker's live source.
 *
 * An all-zero catalog cost for an OpenRouter model means the catalog never
 * priced it (`stealth/union-alpha`, `openrouter/auto`) - it never means
 * "free". OpenRouter publishes its own per-token prices at `api/v1/models`,
 * readable without credentials; this module converts them to the picker's unit
 * (USD per million tokens) and keeps a rate the API does not publish missing
 * instead of zero. A model is free only when every price the API publishes for
 * it is explicitly zero: a per-request, image, search or tiered price keeps it
 * non-free, and the negative sentinel OpenRouter uses for dynamic routing
 * (`openrouter/auto`: -1) stays unknown.
 *
 * The list is read lazily, once per session, behind a deadline; a read that
 * fails or exceeds its budget leaves the last list (or none) in place, so the
 * picker opens immediately from the catalog and never claims a free model it
 * cannot prove. The request carries no credentials.
 */

import { readBoundedText } from '../http/bounded-response.ts'

import { parseModelReference } from './chain.ts'

const MODELS_URL = 'https://openrouter.ai/api/v1/models'
const FETCH_DEADLINE_MS = 3_000
const MAX_RESPONSE_BYTES = 4_000_000
const TOKENS_PER_MILLION = 1_000_000
const OPENROUTER_PROVIDER = 'openrouter'

type RateField = 'prompt' | 'completion' | 'cacheRead' | 'cacheWrite'

/** The flat per-token rates the picker prints, keyed by the API's own names. */
const RATE_FIELDS: Record<string, RateField> = {
	prompt: 'prompt',
	completion: 'completion',
	input_cache_read: 'cacheRead',
	input_cache_write: 'cacheWrite',
}

/**
 * What OpenRouter publishes for one model, in USD per million tokens; `null`
 * is a rate the API did not publish, and is never read as a zero.
 */
export interface OpenRouterModelPrice {
	prompt: number | null
	completion: number | null
	cacheRead: number | null
	cacheWrite: number | null
	/** A published price outside those four rates: per-request, image, search, tiers. */
	hasAdditionalPrice: boolean
}

export interface OpenRouterPricing {
	fetchedAt: number
	/** Keyed by the API's own model id, matched exactly (`stealth/union-alpha`). */
	prices: ReadonlyMap<string, OpenRouterModelPrice>
}

/** The one HTTP verb this module needs; pi's global fetch satisfies it. */
export type PriceFetcher = (url: string, init: RequestInit) => Promise<Response>

/** One session's cache: concurrent refreshes share a single read. */
export interface OpenRouterPricingSource {
	/** The last successful list, or nothing when none has been read yet. */
	snapshot(): OpenRouterPricing | undefined
	/** Read once; a failed read keeps the cache and retries on the next call. */
	refresh(): Promise<OpenRouterPricing | undefined>
}

/**
 * JSON-value narrowing for the payload this module reads. The rule's own docs
 * sanction exactly this: one canonical low-level guard at a JSON boundary
 * (`extensions/footer/json.ts` declares the footer's own copy).
 */
// oxlint-disable-next-line nextnode/no-generic-runtime-guard - sanctioned JSON boundary guard
function isRecord(candidate: unknown): candidate is Record<string, unknown> {
	return typeof candidate === 'object' && candidate !== null
}

/** A published USD price; a negative value is OpenRouter's dynamic sentinel. */
function publishedPrice(raw: unknown): number | null {
	const parsed =
		typeof raw === 'string' || typeof raw === 'number'
			? Number(raw)
			: Number.NaN
	if (!Number.isFinite(parsed) || parsed < 0) return null
	return parsed
}

function parsePrice(pricing: unknown): OpenRouterModelPrice | undefined {
	if (!isRecord(pricing)) return undefined
	const rates: Partial<Record<RateField, number>> = {}
	let hasAdditionalPrice = false
	for (const [field, raw] of Object.entries(pricing)) {
		const rate = RATE_FIELDS[field]
		const price = publishedPrice(raw)
		if (rate && price !== null) rates[rate] = price * TOKENS_PER_MILLION
		if (!rate && (price === null || price > 0)) hasAdditionalPrice = true
	}
	return {
		prompt: rates.prompt ?? null,
		completion: rates.completion ?? null,
		cacheRead: rates.cacheRead ?? null,
		cacheWrite: rates.cacheWrite ?? null,
		hasAdditionalPrice,
	}
}

/**
 * The list's prices by model id. An entry without an id or a pricing object is
 * skipped: the picker keeps its catalog fallback for it instead of inventing a
 * price.
 */
export function parseOpenRouterModels(
	payload: unknown,
): Map<string, OpenRouterModelPrice> {
	const prices = new Map<string, OpenRouterModelPrice>()
	if (!isRecord(payload)) return prices
	const { data } = payload
	if (!Array.isArray(data)) return prices
	for (const entry of data) {
		if (!isRecord(entry)) continue
		const { id, pricing } = entry
		if (typeof id !== 'string' || !id) continue
		const price = parsePrice(pricing)
		if (price) prices.set(id, price)
	}
	return prices
}

/** Whether the picker has a flat rate to show; a -1 sentinel is not one. */
export function hasPublishedRate(price: OpenRouterModelPrice): boolean {
	return (
		price.prompt !== null ||
		price.completion !== null ||
		price.cacheRead !== null ||
		price.cacheWrite !== null
	)
}

function isZeroOrMissing(rate: number | null): boolean {
	return rate === null || rate === 0
}

/** Free only when every price the API publishes is explicitly zero. */
export function isFreeOpenRouterPrice(price: OpenRouterModelPrice): boolean {
	return (
		price.prompt === 0 &&
		price.completion === 0 &&
		isZeroOrMissing(price.cacheRead) &&
		isZeroOrMissing(price.cacheWrite) &&
		!price.hasAdditionalPrice
	)
}

/** The OpenRouter model id a picker reference names, when it names one. */
export function openRouterIdFor(reference: string): string | undefined {
	const parsed = parseModelReference(reference)
	if (!parsed || parsed.provider !== OPENROUTER_PROVIDER) return undefined
	return parsed.modelId
}

async function readOpenRouterPricing(
	fetcher: PriceFetcher,
): Promise<OpenRouterPricing | undefined> {
	try {
		const response = await fetcher(MODELS_URL, {
			headers: { accept: 'application/json' },
			signal: AbortSignal.timeout(FETCH_DEADLINE_MS),
		})
		if (!response.ok) return undefined
		const body = await readBoundedText(response, MAX_RESPONSE_BYTES)
		if (!body) return undefined
		return {
			fetchedAt: Date.now(),
			prices: parseOpenRouterModels(JSON.parse(body)),
		}
	} catch {
		return undefined
	}
}

/** A source reads the public list once per session and then serves it. */
export function createOpenRouterPricingSource(
	fetcher: PriceFetcher = fetch,
): OpenRouterPricingSource {
	let list: OpenRouterPricing | undefined
	let pending: Promise<OpenRouterPricing | undefined> | undefined
	return {
		snapshot: () => list,
		refresh: async () => {
			if (list) return list
			if (!pending) pending = readOpenRouterPricing(fetcher)
			const next = await pending
			pending = undefined
			if (next) list = next
			return next
		},
	}
}
