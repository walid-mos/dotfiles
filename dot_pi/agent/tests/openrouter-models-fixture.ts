/**
 * The live OpenRouter price list, captured from the public
 * `https://openrouter.ai/api/v1/models` response on 2026-09-16 and reduced to
 * `id`, `name` and `pricing` - the fields the picker reads - with prices left
 * exactly as the endpoint publishes them (USD per token). No credentials are
 * sent to that endpoint and none are stored here.
 *
 * `stealth/union-alpha` is the live zero-cost model this fixture pins;
 * `qwen/qwen3.8-flash` is a paid entry whose per-token prices must convert to
 * the picker's per-million columns; `openrouter/auto` carries OpenRouter's -1
 * sentinel for dynamic prices.
 */

import type { PriceFetcher } from '../extensions/model-fallback/openrouter-pricing.ts'

export const OPENROUTER_MODELS_RESPONSE = {
	data: [
		{
			id: 'stealth/union-alpha',
			name: 'Union Alpha',
			pricing: { prompt: '0', completion: '0' },
		},
		{
			id: 'qwen/qwen3.8-flash',
			name: 'Qwen: Qwen3.8 Flash',
			pricing: {
				prompt: '0.00000015',
				completion: '0.00000047',
				input_cache_read: '0.000000016',
				input_cache_write: '0.0000002',
			},
		},
		{
			id: 'openrouter/auto',
			name: 'Auto Router',
			pricing: { prompt: '-1', completion: '-1' },
		},
	],
}

/** The captured list as the production adapter reads it: a fetch double. */
export function openRouterFixtureFetch(): PriceFetcher {
	return async () =>
		new Response(JSON.stringify(OPENROUTER_MODELS_RESPONSE), {
			headers: { 'content-type': 'application/json' },
			status: 200,
		})
}
