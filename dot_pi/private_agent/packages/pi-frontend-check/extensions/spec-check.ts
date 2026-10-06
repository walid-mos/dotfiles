// frontend_compare mode=spec: judge the open page against a spec file. The spec lives in the
// project repo as JSON - a list of checkable requirements with their source - so the
// tool itself carries nothing project-specific. One batched Jev call judges every item
// over the extracted specimen; the confidence gate routes anything unproven to the
// agent instead of inventing a verdict.
//
// Measured contract (jev-decision-layer, surface 3): `satisfied`/`violated` only on
// direct evidence, `cannot-tell` is a faithful report of a hole in the extraction, and
// a gate around 0.55 separated every correct verdict (0.83-1.00) from every failure
// (0.40-0.71) with zero wrong auto-verdicts.

import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'

import { Value } from 'typebox/value'

import { askChoices, estimateUsd } from './jev-client.ts'
import { boundedText } from './report.ts'
import { specFileSchema } from './schema.ts'

import type { ChoiceAnswer, JevChoiceQuestion } from './jev-client.ts'
import type { PageSpecimen } from './page-specimen.ts'
import type { SpecFile, SpecItem } from './schema.ts'

/** Below this, the verdict is reported as needing an agent check instead of auto. */
export const AUTO_VERDICT_CONFIDENCE = 0.55
/** Decimal places for reported confidences and costs. */
const REPORT_DECIMALS = 2
const COST_DECIMALS = 6

const SPEC_JUDGMENT_INSTRUCTIONS =
	'Judge whether the rendered page state satisfies this requirement. Answer "satisfied" only when the state carries direct evidence that the requirement holds. Answer "violated" only when the state carries direct evidence that it is broken. Answer "cannot-tell" when the state does not carry the evidence to decide - never guess from absence or from a bare count where the requirement needs content.'

const SPEC_CRITERIA: Record<string, string> = {
	satisfied: 'The page state directly shows the requirement holds.',
	violated: 'The page state directly shows the requirement is broken.',
	'cannot-tell':
		'The state lacks the evidence to decide; do not use this for borderline readings.',
}

const REPORT_LIMIT = 16000
const ITEM_LINE_CHARS = 180
/** JSON.stringify indent for the no-key page-state fallback. */
const STATE_INDENT = 2

/** Validated by the typebox schema; the raw file is untrusted shape until then. */
export function readSpecFile(raw: unknown, source: string): SpecFile {
	if (!Value.Check(specFileSchema, raw)) {
		const errors = [...Value.Errors(specFileSchema, raw)]
			.map(error => `${error.instancePath || '/'} ${error.message}`)
			.join('; ')
		throw new Error(`Invalid spec file ${source}: ${errors}`)
	}
	return raw
}

export async function loadSpecFile(
	path: string,
	cwd: string,
): Promise<SpecFile> {
	const resolved = isAbsolute(path) ? path : resolve(cwd, path)
	const raw: unknown = JSON.parse(await readFile(resolved, 'utf8'))
	return readSpecFile(raw, resolved)
}

function specQuestions(spec: SpecFile): Record<string, JevChoiceQuestion> {
	return Object.fromEntries(
		spec.items.map(specItem => [
			specItem.id,
			{
				instructions: `${specItem.requirement}\n\n${SPEC_JUDGMENT_INSTRUCTIONS}`,
				criteria: SPEC_CRITERIA,
			},
		]),
	)
}

export type SpecVerdict = {
	id: string
	requirement: string
	verdict: 'pass' | 'violation' | 'needs-agent-check'
	choice: string
	confidence: number
}

/** Confident satisfied/violated is auto-reported; everything else goes to the agent. */
export function verdictFor(
	specItem: SpecItem,
	answer: ChoiceAnswer,
): SpecVerdict {
	const isConfident = answer.confidence >= AUTO_VERDICT_CONFIDENCE
	const verdict = autoVerdict(answer.choice, isConfident)
	return {
		id: specItem.id,
		requirement: specItem.requirement,
		verdict,
		choice: answer.choice,
		confidence: answer.confidence,
	}
}

function autoVerdict(
	choice: string,
	isConfident: boolean,
): SpecVerdict['verdict'] {
	if (choice === 'satisfied' && isConfident) return 'pass'
	if (choice === 'violated' && isConfident) return 'violation'
	return 'needs-agent-check'
}

export type SpecCheckResult = {
	spec: string
	url: string
	verdicts: SpecVerdict[]
	model?: string
	inputTokens?: number
	costUsd?: number
	latencyMs?: number
	jevUsed: boolean
}

/** One Jev call for the whole spec; throws on API errors - the tool reports them. */
export async function judgeSpec(
	spec: SpecFile,
	specimen: PageSpecimen,
): Promise<SpecCheckResult> {
	const answers = await askChoices({ page: specimen }, specQuestions(spec))
	const verdicts = spec.items.map(specItem => {
		const answer = answers.answers[specItem.id]
		if (!answer)
			throw new Error(
				`jev returned no answer for spec item "${specItem.id}"`,
			)
		return verdictFor(specItem, answer)
	})
	return {
		spec: spec.name ?? `${spec.items.length} items`,
		url: specimen.url,
		verdicts,
		model: answers.model,
		inputTokens: answers.inputTokens,
		costUsd: estimateUsd(answers.inputTokens),
		latencyMs: answers.latencyMs,
		jevUsed: true,
	}
}

export function formatSpecReport(
	check: SpecCheckResult,
	specimen?: PageSpecimen,
): string {
	const violations = check.verdicts.filter(v => v.verdict === 'violation')
	const needsCheck = check.verdicts.filter(
		v => v.verdict === 'needs-agent-check',
	)
	const passes = check.verdicts.filter(v => v.verdict === 'pass')
	const lines = [
		`spec check: ${check.spec} | ${check.url}`,
		check.jevUsed
			? `judged by ${check.model}, one call | ${check.inputTokens} input tokens | $${check.costUsd?.toFixed(COST_DECIMALS)} | ${check.latencyMs}ms | gate ${AUTO_VERDICT_CONFIDENCE}: below it, or cannot-tell, is never auto-passed`
			: `TYPESAFE_API_KEY not set - no judgment ran. The extracted page state follows; judge it yourself or interact with the page.`,
		`totals: ${passes.length} pass | ${violations.length} violation | ${needsCheck.length} needs agent check`,
		...group(
			'VIOLATIONS - direct evidence the requirement is broken:',
			violations,
		),
		...group(
			'NEEDS AGENT CHECK - not proven by the extracted state:',
			needsCheck,
		),
		passes.length
			? `PASS (${passes.length}): ${passes.map(v => v.id).join(', ')}`
			: '',
		...(check.jevUsed || !specimen
			? []
			: [
					`\npage state:\n${JSON.stringify(specimen, null, STATE_INDENT)}`,
				]),
	].filter(Boolean)
	return boundedText(lines.join('\n'), REPORT_LIMIT)
}

function group(title: string, verdicts: SpecVerdict[]): string[] {
	if (!verdicts.length) return []
	return [
		title,
		...verdicts.map(
			v =>
				`- ${v.id} [${v.choice} ${v.confidence.toFixed(REPORT_DECIMALS)}] ${clip(v.requirement, ITEM_LINE_CHARS)}`,
		),
	]
}

function clip(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
