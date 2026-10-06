// Named page assertions in one browser round trip: every expression of a
// frontend_eval `checks` list or a frontend_batch `evals` list runs inside a
// single page.evaluate and comes back as one object, so a verification state
// costs one tool call instead of one call per fact.
import { boundedText } from './report.ts'

import type { Page } from 'playwright-core'
import type { Checks } from './action-schema.ts'

const JSON_INDENT = 2

/**
 * Serialized into the page. Each source is evaluated like frontend_eval's
 * single expression (expression form first, statement form as fallback) and
 * awaited; a failing check reports its own error instead of failing the rest.
 */
async function runChecks(
	sources: [string, string][],
): Promise<Record<string, unknown>> {
	const results: Record<string, unknown> = {}
	// The expressions are the tool's input, exactly like page.evaluate(string).
	// oxlint-disable-next-line unicorn/consistent-function-scoping -- must stay inside the function Playwright serializes
	const evaluate = (source: string): unknown => {
		try {
			// oxlint-disable-next-line no-eval -- page-side evaluation is this tool's purpose
			return (0, eval)(`(${source})`)
		} catch (error) {
			if (!(error instanceof SyntaxError)) throw error
			// oxlint-disable-next-line no-eval -- statement form of the same expression
			return (0, eval)(source)
		}
	}
	for (const [name, source] of sources) {
		try {
			// Checks may depend on each other's side effects; keep their order.
			// oxlint-disable-next-line no-await-in-loop
			results[name] = await evaluate(source)
		} catch (error) {
			results[name] = {
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}
	return results
}

export async function evaluateChecks(
	page: Page,
	checks: Checks,
	maxBytes: number,
): Promise<string> {
	const names = new Set<string>()
	for (const check of checks) {
		if (names.has(check.name))
			throw new Error(`Duplicate check name "${check.name}".`)
		names.add(check.name)
	}
	const results = await page.evaluate(
		runChecks,
		checks.map((check): [string, string] => [check.name, check.expression]),
	)
	return boundedText(JSON.stringify(results, null, JSON_INDENT), maxBytes)
}
