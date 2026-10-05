// Human-readable ISO diff report: deterministic deltas plus, when present, the Jev
// fidelity verdicts. Pure formatting - the diff computation lives in iso-diff.ts,
// the judgment in iso-judge.ts.

import { boundedText } from './report.ts'
import { AUTO_VERDICT_CONFIDENCE } from './spec-check.ts'

import type { IsoJudgment } from './iso-judge.ts'
import type { SpecimenComponent } from './page-specimen.ts'
import type { PairDiff, IsoDiff } from './specimen-diff.ts'

const REPORT_LIMIT = 16000
/** Decimal places for reported confidences and costs. */
const REPORT_DECIMALS = 2
const COST_DECIMALS = 6
/** Cap on the unmatched-component listing in the report. */
const ONLY_LIST_LIMIT = 20

function unjudgedLine(pairCount: number): string {
	return pairCount
		? `TYPESAFE_API_KEY not set - deterministic diff only, no semantic judgment.`
		: `no differing pairs - nothing to judge.`
}

function describePair(
	pair: PairDiff,
	verdict?: { verdict: string; choice: string; confidence: number },
): string {
	const label = `${pair.role} "${pair.implementationText || pair.baselineText}"`
	const state = verdict
		? ` [${verdict.verdict}, ${verdict.choice} ${verdict.confidence.toFixed(REPORT_DECIMALS)}]`
		: ''
	const deltas = pair.styleDeltas
		.map(
			delta =>
				`${delta.property}: ${delta.implementation} -> ${delta.baseline}`,
		)
		.join('; ')
	const size = pair.sizeDelta
		? `; size: ${pair.sizeDelta.implementation} -> ${pair.sizeDelta.baseline}`
		: ''
	const position = pair.positionDelta
		? `; position: ${pair.positionDelta.implementation} -> ${pair.positionDelta.baseline}`
		: ''
	const attributes = pair.attributesDelta
		? `; attributes: ${pair.attributesDelta.implementation} -> ${pair.attributesDelta.baseline}`
		: ''
	const text =
		pair.implementationText === pair.baselineText
			? ''
			: `; text: ${pair.implementationText} -> ${pair.baselineText}`
	const detail =
		`${deltas}${size}${position}${attributes}${text}`.replace(/^; /, '') ||
		'different computed styles'
	return `- ${label}${state}: ${detail}`
}

export function formatIsoReport(diff: IsoDiff, judgment?: IsoJudgment): string {
	const lines = [
		`ISO diff: implementation ${diff.implementationUrl}`,
		`    vs baseline ${diff.baselineUrl}`,
		judgment
			? `judged by ${judgment.model}, one call | ${judgment.inputTokens} input tokens | $${judgment.costUsd.toFixed(COST_DECIMALS)} | ${judgment.latencyMs}ms | gate ${AUTO_VERDICT_CONFIDENCE}`
			: unjudgedLine(diff.pairs.length),
		`totals: ${diff.identicalSignatures} identical signatures | ${diff.pairs.length} differing pairs | ${diff.onlyImplementation.length} only on implementation | ${diff.onlyBaseline.length} only on baseline`,
		...(judgment
			? judgmentLines(judgment)
			: diff.pairs.map(pair => describePair(pair))),
		...onlyLines(
			'ONLY ON IMPLEMENTATION - absent from baseline:',
			diff.onlyImplementation,
		),
		...onlyLines(
			'ONLY ON BASELINE - absent from implementation:',
			diff.onlyBaseline,
		),
	]
	return boundedText(lines.join('\n'), REPORT_LIMIT)
}

function judgmentLines(judgment: IsoJudgment): string[] {
	return [
		...verdictLines(
			'MATCH - visually the same design:',
			judgment.verdicts.filter(v => v.verdict === 'match'),
		),
		...verdictLines(
			'MISMATCH - visible visual difference:',
			judgment.verdicts.filter(v => v.verdict === 'mismatch'),
		),
		...verdictLines(
			'NEEDS AGENT CHECK:',
			judgment.verdicts.filter(v => v.verdict === 'needs-agent-check'),
		),
	].filter(Boolean)
}

function verdictLines(
	title: string,
	verdicts: {
		pair: PairDiff
		verdict: string
		choice: string
		confidence: number
	}[],
): string[] {
	if (!verdicts.length) return []
	return [title, ...verdicts.map(v => describePair(v.pair, v))]
}

function onlyLines(title: string, components: SpecimenComponent[]): string[] {
	if (!components.length) return []
	return [
		title,
		...components
			.slice(0, ONLY_LIST_LIMIT)
			.map(component => `- ${component.role} "${component.text}"`),
	]
}
