// ISO diff judgment. Code decides color deltas (color-delta.ts); one batched Jev
// call judges every other difference, each question naming its pair by state path
// because question IDs never reach the model.

import { COLOR_MATCH_DELTA_E, compareColors } from './color-delta.ts'
import { askChoices, estimateUsd, isJevConfigured } from './jev-client.ts'
import { AUTO_VERDICT_CONFIDENCE } from './spec-check.ts'

import type { ChoiceAnswer } from './jev-client.ts'
import type { PairDiff } from './specimen-diff.ts'

const DELTA_E_DECIMALS = 3

const PAIR_CRITERIA: Record<string, string> = {
	identical:
		'The two rendered components are visually the same design under a faithful-reproduction standard.',
	violated: 'The two rendered components differ visibly.',
	'cannot-tell': 'The listed differences lack the evidence to decide.',
}

type Difference = { property: string; implementation: string; baseline: string }

export type IsoVerdict = {
	pair: PairDiff
	verdict: 'match' | 'mismatch' | 'needs-agent-check'
	basis:
		| { decidedBy: 'code'; reason: string }
		| { decidedBy: 'jev'; choice: string; confidence: number }
}

export type IsoJudgment = {
	verdicts: IsoVerdict[]
	unjudged: PairDiff[]
	jev?: {
		model: string
		inputTokens: number
		costUsd: number
		latencyMs: number
	}
}

type Screened =
	| { kind: 'decided'; verdict: IsoVerdict }
	| { kind: 'residual'; pair: PairDiff; differences: Difference[] }

type Residual = Extract<Screened, { kind: 'residual' }>

type StyleScreen =
	| { kind: 'drift'; label: string }
	| { kind: 'noise' }
	| { kind: 'difference'; difference: Difference }

function screenStyleDelta(delta: Difference): StyleScreen {
	const colors = compareColors(delta.implementation, delta.baseline)
	if (!colors) return { kind: 'difference', difference: delta }
	if (colors.deltaE > COLOR_MATCH_DELTA_E)
		return {
			kind: 'drift',
			label: `${delta.property} ΔE ${colors.deltaE.toFixed(DELTA_E_DECIMALS)}`,
		}
	if (colors.recolored === delta.baseline) return { kind: 'noise' }
	return {
		kind: 'difference',
		difference: { ...delta, implementation: colors.recolored },
	}
}

type SideValues = Omit<Difference, 'property'>

function textDelta(pair: PairDiff): SideValues | undefined {
	if (pair.implementationText === pair.baselineText) return undefined
	return {
		implementation: pair.implementationText,
		baseline: pair.baselineText,
	}
}

function nonStyleDifferences(pair: PairDiff): Difference[] {
	const candidates: [string, SideValues | undefined][] = [
		['visible text', textDelta(pair)],
		['size (width x height, px)', pair.sizeDelta],
		['position (x,y in the viewport, px)', pair.positionDelta],
		['attributes', pair.attributesDelta],
	]
	return candidates.flatMap(([property, delta]) =>
		delta ? [{ property, ...delta }] : [],
	)
}

function decided(
	pair: PairDiff,
	verdict: 'match' | 'mismatch',
	reason: string,
): Screened {
	return {
		kind: 'decided',
		verdict: { pair, verdict, basis: { decidedBy: 'code', reason } },
	}
}

function screenPair(pair: PairDiff): Screened {
	const screens = pair.styleDeltas.map(screenStyleDelta)
	const drift = screens.flatMap(screen =>
		screen.kind === 'drift' ? [screen.label] : [],
	)
	if (drift.length)
		return decided(
			pair,
			'mismatch',
			`color drift ${drift.join(', ')} > ${COLOR_MATCH_DELTA_E}`,
		)
	const differences = [
		...screens.flatMap(screen =>
			screen.kind === 'difference' ? [screen.difference] : [],
		),
		...nonStyleDifferences(pair),
	]
	if (!differences.length)
		return decided(pair, 'match', `colors within ΔE ${COLOR_MATCH_DELTA_E}`)
	return { kind: 'residual', pair, differences }
}

function pairInstructions(index: number): string {
	const path = `pairs[${index}]`
	return `Compare the implementation and baseline renderings of the component at \`${path}\`. \`${path}.differences\` lists every property where they differ, each with its implementation and baseline value. Answer "identical" when those differences keep the same visual design under a faithful-reproduction standard: minor rounding, anti-aliasing or sub-pixel differences do not count, and a deliberate state variant the design system also uses in the baseline does not break fidelity. Answer "violated" when a listed difference is visible. Answer "cannot-tell" when the listed values do not carry enough evidence.`
}

function jevVerdict(answer: ChoiceAnswer): IsoVerdict['verdict'] {
	if (answer.confidence < AUTO_VERDICT_CONFIDENCE) return 'needs-agent-check'
	if (answer.choice === 'identical') return 'match'
	if (answer.choice === 'violated') return 'mismatch'
	return 'needs-agent-check'
}

async function judgeWithJev(
	residuals: Residual[],
): Promise<Required<IsoJudgment>> {
	const state = {
		pairs: residuals.map(({ pair, differences }) => ({
			role: pair.role,
			text: pair.implementationText || pair.baselineText,
			differences,
		})),
	}
	const questions = Object.fromEntries(
		residuals.map((_, index) => [
			`pair_${index}`,
			{ instructions: pairInstructions(index), criteria: PAIR_CRITERIA },
		]),
	)
	const answers = await askChoices(state, questions)
	const verdicts = residuals.map(({ pair }, index): IsoVerdict => {
		const answer = answers.answers[`pair_${index}`]
		if (!answer)
			throw new Error(`jev returned no answer for "pair_${index}"`)
		const { choice, confidence } = answer
		return {
			pair,
			verdict: jevVerdict(answer),
			basis: { decidedBy: 'jev', choice, confidence },
		}
	})
	return {
		verdicts,
		unjudged: [],
		jev: {
			model: answers.model,
			inputTokens: answers.inputTokens,
			costUsd: estimateUsd(answers.inputTokens),
			latencyMs: answers.latencyMs,
		},
	}
}

export async function judgePairs(pairs: PairDiff[]): Promise<IsoJudgment> {
	const screened = pairs.map(screenPair)
	const codeVerdicts = screened.flatMap(screen =>
		screen.kind === 'decided' ? [screen.verdict] : [],
	)
	const residuals = screened.filter(
		(screen): screen is Residual => screen.kind === 'residual',
	)
	if (!residuals.length || !isJevConfigured())
		return {
			verdicts: codeVerdicts,
			unjudged: residuals.map(residual => residual.pair),
		}
	const judged = await judgeWithJev(residuals)
	return { ...judged, verdicts: [...codeVerdicts, ...judged.verdicts] }
}
