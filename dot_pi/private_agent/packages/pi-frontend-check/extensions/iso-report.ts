// Human-readable ISO diff report: deterministic deltas plus the code and Jev
// verdicts. Pure formatting - the diff computation lives in iso-diff.ts, the
// judgment in iso-judge.ts.

import { COLOR_MATCH_DELTA_E } from './color-delta.ts'
import { boundedText } from './report.ts'
import { AUTO_VERDICT_CONFIDENCE } from './spec-check.ts'

import type { IsoJudgment, IsoVerdict } from './iso-judge.ts'
import type { SpecimenComponent } from './page-specimen.ts'
import type { PairDiff, IsoDiff } from './specimen-diff.ts'

const REPORT_LIMIT = 16000
/** Decimal places for reported confidences and costs. */
const REPORT_DECIMALS = 2
const COST_DECIMALS = 6
/** Cap on the unmatched-component listing in the report. */
const ONLY_LIST_LIMIT = 20

function judgmentLine(pairCount: number, judgment: IsoJudgment): string {
	const colors = `colors decided in code: OKLab ΔE above ${COLOR_MATCH_DELTA_E} is drift`
	if (judgment.jev)
		return `judged by ${judgment.jev.model}, one call | ${judgment.jev.inputTokens} input tokens | $${judgment.jev.costUsd.toFixed(COST_DECIMALS)} | ${judgment.jev.latencyMs}ms | gate ${AUTO_VERDICT_CONFIDENCE} | ${colors}`
	if (judgment.unjudged.length)
		return `TYPESAFE_API_KEY not set - ${judgment.unjudged.length} pairs left to your judgment | ${colors}`
	return pairCount
		? `${colors} | nothing left for Jev`
		: `no differing pairs - nothing to judge.`
}

function verdictLabel(verdict: IsoVerdict): string {
	const { basis } = verdict
	return basis.decidedBy === 'code'
		? ` [${verdict.verdict}, code: ${basis.reason}]`
		: ` [${verdict.verdict}, ${basis.choice} ${basis.confidence.toFixed(REPORT_DECIMALS)}]`
}

function describePair(pair: PairDiff, verdict?: IsoVerdict): string {
	const label = `${pair.role} "${pair.implementationText || pair.baselineText}"`
	const state = verdict ? verdictLabel(verdict) : ''
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

export function formatIsoReport(diff: IsoDiff, judgment: IsoJudgment): string {
	const lines = [
		`ISO diff: implementation ${diff.implementationUrl}`,
		`    vs baseline ${diff.baselineUrl}`,
		judgmentLine(diff.pairs.length, judgment),
		`totals: ${diff.identicalSignatures} identical signatures | ${diff.pairs.length} differing pairs | ${diff.onlyImplementation.length} only on implementation | ${diff.onlyBaseline.length} only on baseline`,
		...judgmentLines(judgment),
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
		...(judgment.unjudged.length
			? [
					'UNJUDGED - not decidable in code:',
					...judgment.unjudged.map(pair => describePair(pair)),
				]
			: []),
	]
}

function verdictLines(title: string, verdicts: IsoVerdict[]): string[] {
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
