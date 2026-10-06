/** Tell the model, at every prompt, how much a codemode script may print: pi's description names
 * the `@options` line but not the default cap, so a batch of reads silently loses its middle. */

/** pi's documented default for `max_output_tokens` (docs/codemode.md); restated so the model can size a budget. */
const DEFAULT_OUTPUT_TOKENS = 10_000

export const CODEMODE_OUTPUT_GUIDELINE = `A codemode script returns at most ${String(DEFAULT_OUTPUT_TOKENS)} tokens of output by default (start and end kept, the middle only in a temp file): when batched reads may exceed it, set \`// @options: {"max_output_tokens": <n>}\` on the first line, or print only the extract you need.`

interface GuidelineOptions {
	selectedTools: string[]
	toolGuidelines: Record<string, string[]>
}

/** Append the budget guideline under the codemode tool, once, only while codemode is selected. */
export function addCodemodeBudgetGuideline(options: GuidelineOptions): void {
	if (!options.selectedTools.includes('codemode')) return
	// oxlint-disable-next-line eslint/no-param-reassign - pi documents systemPromptOptions as mutable; later handlers observe the change
	const guidelines = (options.toolGuidelines.codemode ??= [])
	if (!guidelines.includes(CODEMODE_OUTPUT_GUIDELINE))
		guidelines.push(CODEMODE_OUTPUT_GUIDELINE)
}
