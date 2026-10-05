import { launchBrowser, openContext } from './browser-launch.ts'
// frontend_iso_diff: compare the rendered implementation against a baseline (a
// prototype page, not a mockup image). Each side is a specimen captured from the
// session browser (frontend_capture_specimen - the only way to reach pages behind
// login or session-only navigation) or a cold URL. Matching component styles,
// text, attributes and geometry avoid a model call; this is diagnostic, not a
// pixel-level pass gate. Differing pairs are reported with code-computed deltas and, when TYPESAFE_API_KEY
// is set, a batched Jev fidelity judgment (iso-judge.ts, report in iso-report.ts).
import { loadCapturedSpecimen } from './capture-specimen.ts'
import { judgePairs } from './iso-judge.ts'
import { formatIsoReport } from './iso-report.ts'
import { extractSpecimen } from './page-specimen.ts'
import { diffSpecimens } from './specimen-diff.ts'

import type { Browser } from 'playwright-core'
import type { PageSpecimen } from './page-specimen.ts'
import type { Config, IsoDiffParams } from './schema.ts'

/** One diff side: a specimen captured from the session browser, or a cold URL. */
export type IsoSide =
	| { kind: 'captured'; reference: string }
	| { kind: 'url'; url: string }

/** Each side takes exactly one input; missing or doubled inputs are spec errors. */
function isoSide(
	reference: string | undefined,
	url: string | undefined,
	side: 'a' | 'b',
): IsoSide {
	if (reference && url)
		throw new Error(
			`Diff side ${side} takes exactly one input: a captured_${side} name or a *_url - not both.`,
		)
	if (reference) return { kind: 'captured', reference }
	if (url) return { kind: 'url', url }
	throw new Error(
		'frontend_iso_diff needs both sides: captured_a/captured_b (specimens captured in the session browser) or implementation_url/baseline_url (directly reachable pages).',
	)
}

/** Implementation side = captured_a or implementation_url; baseline side = captured_b or baseline_url. */
export function resolveIsoSides(params: IsoDiffParams): {
	a: IsoSide
	b: IsoSide
} {
	return {
		a: isoSide(params.captured_a, params.implementation_url, 'a'),
		b: isoSide(params.captured_b, params.baseline_url, 'b'),
	}
}

/** URL sides extract with the diff's shared readiness + scope options. */
type ExtractOptions = { waitFor?: string; scope?: string }

async function specimenFor(
	side: IsoSide,
	config: Config,
	browser: Browser | undefined,
	extract: ExtractOptions,
): Promise<PageSpecimen> {
	if (side.kind === 'captured') return loadCapturedSpecimen(side.reference)
	if (!browser)
		throw new Error('No browser open for a URL side - internal error.')
	return extractFromPage(browser, config, side.url, extract)
}

/** Captured sides load from disk; URL sides get one shared cold browser, then it closes. */
export async function runIsoDiff(
	params: IsoDiffParams,
	config: Config,
	signal?: AbortSignal,
): Promise<string> {
	const sides = resolveIsoSides(params)
	const browser = [sides.a, sides.b].some(side => side.kind === 'url')
		? await launchBrowser(config)
		: undefined
	const cancel = (): void => void browser?.close()
	signal?.addEventListener('abort', cancel)
	try {
		const [implementation, baseline] = await Promise.all([
			specimenFor(sides.a, config, browser, params),
			specimenFor(sides.b, config, browser, params),
		])
		const diff = diffSpecimens(implementation, baseline)
		const judgment =
			isJevAvailable() && diff.pairs.length
				? await judgePairs(diff.pairs)
				: undefined
		return formatIsoReport(diff, judgment)
	} finally {
		signal?.removeEventListener('abort', cancel)
		await browser?.close()
	}
}

function isJevAvailable(): boolean {
	return Boolean(process.env.TYPESAFE_API_KEY?.trim())
}

async function extractFromPage(
	browser: Browser,
	config: Config,
	url: string,
	extract: ExtractOptions,
): Promise<PageSpecimen> {
	const context = await openContext(browser, config)
	try {
		const page = await context.newPage()
		await page.goto(url, { waitUntil: 'commit' })
		await page.locator('body').waitFor({ state: 'attached' })
		if (extract.waitFor)
			await page.locator(extract.waitFor).waitFor({ state: 'visible' })
		return await page.evaluate(extractSpecimen, extract.scope)
	} finally {
		await context.close()
	}
}
