// Jev judgment for the ISO diff: one batched call over every differing component
// pair. Code computes the deltas; Jev only decides whether a computed difference
// breaks a faithful-reproduction standard. Colors are sent as named colors - Jev
// cannot reliably compare hex or RGB values (jev-1.13 jaggedness #2).

import { askChoices, estimateUsd } from './jev-client.ts'
import { AUTO_VERDICT_CONFIDENCE } from './spec-check.ts'

import type { JevChoiceQuestion } from './jev-client.ts'
import type { SpecimenStyles } from './page-specimen.ts'
import type { PairDiff } from './specimen-diff.ts'

// CSS named colors by channel triplet as a string, so the values are data, not
// magic numbers: parsed into channels at startup. Jev never sees hex values.
const NAMED_COLOR_RGB: Record<string, string> = {
	black: '0 0 0',
	white: '255 255 255',
	red: '255 0 0',
	orange: '255 165 0',
	yellow: '255 255 0',
	green: '0 128 0',
	teal: '0 128 128',
	cyan: '0 255 255',
	blue: '0 0 255',
	navy: '0 0 128',
	indigo: '75 0 130',
	purple: '128 0 128',
	magenta: '255 0 255',
	pink: '255 192 203',
	gray: '128 128 128',
	silver: '192 192 192',
	brown: '165 42 42',
	maroon: '128 0 0',
	olive: '128 128 0',
	lime: '0 255 0',
	beige: '245 245 220',
	gold: '255 215 0',
	coral: '255 127 80',
	crimson: '220 20 60',
}

const COLOR_CHANNELS = Object.entries(NAMED_COLOR_RGB).map(([name, rgb]) => {
	const [red = 0, green = 0, blue = 0] = rgb.split(' ').map(Number)
	return { name, red, green, blue }
})

/** Nearest named color for an `rgb(r, g, b)` string; the string itself if unparseable. */
function nearestColorName(rgb: string): string {
	const match = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(rgb)
	if (!match) return rgb
	const [colorRed = 0, colorGreen = 0, colorBlue = 0] = match
		.slice(1)
		.map(Number)
	let best = ''
	let bestDistance = Number.MAX_VALUE
	for (const { name, red, green, blue } of COLOR_CHANNELS) {
		const distance = Math.hypot(
			red - colorRed,
			green - colorGreen,
			blue - colorBlue,
		)
		if (distance < bestDistance) {
			bestDistance = distance
			best = name
		}
	}
	return best
}

/** Every rgb()/rgba() occurrence becomes a named color; the rest stays verbatim. */
function namedStyles(styles: SpecimenStyles): SpecimenStyles {
	return Object.fromEntries(
		Object.entries(styles).map(([property, value]) => [
			property,
			value.replaceAll(/rgba?\([^)]+\)/g, match =>
				match === 'rgba(0, 0, 0, 0)'
					? 'transparent'
					: nearestColorName(match),
			),
		]),
	)
}

const PAIR_JUDGMENT_INSTRUCTIONS =
	'Two renderings of the same component kind are compared. Answer "identical" when the two descriptors describe the same visual design under a faithful-reproduction standard: minor rounding, anti-aliasing or sub-pixel differences do not count, and a deliberate state variant the design system also uses in the baseline does not break fidelity. Answer "violated" when the descriptors show a visible visual difference. Answer "cannot-tell" when the descriptors do not carry enough evidence.'

const PAIR_CRITERIA: Record<string, string> = {
	identical:
		'The two rendered components are visually the same design under a faithful-reproduction standard.',
	violated: 'The two rendered components differ visibly.',
	'cannot-tell': 'The descriptors lack the evidence to decide.',
}

export type IsoVerdict = {
	pair: PairDiff
	verdict: 'match' | 'mismatch' | 'needs-agent-check'
	choice: string
	confidence: number
}

export type IsoJudgment = {
	verdicts: IsoVerdict[]
	model: string
	inputTokens: number
	costUsd: number
	latencyMs: number
}

/** The pair's differing style values on one side, for the judgment state. */
function pairStyles(
	pair: PairDiff,
	side: 'implementation' | 'baseline',
): SpecimenStyles {
	return Object.fromEntries(
		pair.styleDeltas.map(delta => [delta.property, delta[side]]),
	)
}

function verdictFor(
	choice: string,
	isConfident: boolean,
): IsoVerdict['verdict'] {
	if (choice === 'identical' && isConfident) return 'match'
	if (choice === 'violated' && isConfident) return 'mismatch'
	return 'needs-agent-check'
}

/** One Jev call over every differing pair; state carries only what each question needs. */
export async function judgePairs(pairs: PairDiff[]): Promise<IsoJudgment> {
	const state = {
		pairs: pairs.map((pair, index) => ({
			pair: index,
			role: pair.role,
			implementation: {
				text: pair.implementationText,
				styles: namedStyles(pairStyles(pair, 'implementation')),
			},
			baseline: {
				text: pair.baselineText,
				styles: namedStyles(pairStyles(pair, 'baseline')),
			},
		})),
	}
	const questions: Record<string, JevChoiceQuestion> = {}
	for (const [index] of pairs.entries()) {
		questions[`pair_${index}`] = {
			instructions: PAIR_JUDGMENT_INSTRUCTIONS,
			criteria: PAIR_CRITERIA,
		}
	}
	const answers = await askChoices(state, questions)
	const verdicts = pairs.map((pair, index) => {
		const answer = answers.answers[`pair_${index}`]
		if (!answer)
			throw new Error(`jev returned no answer for "pair_${index}"`)
		const isConfident = answer.confidence >= AUTO_VERDICT_CONFIDENCE
		return {
			pair,
			verdict: verdictFor(answer.choice, isConfident),
			choice: answer.choice,
			confidence: answer.confidence,
		}
	})
	return {
		verdicts,
		model: answers.model,
		inputTokens: answers.inputTokens,
		costUsd: estimateUsd(answers.inputTokens),
		latencyMs: answers.latencyMs,
	}
}
