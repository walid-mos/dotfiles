/** Preset token ceilings and the formatting shared by the picker and command. */
const TOKENS_PER_THOUSAND = 1000
const SMALL_BAND = { start: 48, end: 256, step: 8 }
const MEDIUM_BAND = { start: 288, end: 512, step: 32 }
const LARGE_BAND = { start: 576, end: 1024, step: 64 }

function ceilingRange(band: typeof SMALL_BAND): number[] {
	const ceilings: number[] = []
	for (
		let thousands = band.start;
		thousands <= band.end;
		thousands += band.step
	)
		ceilings.push(thousands * TOKENS_PER_THOUSAND)
	return ceilings
}

export const CEILING_PRESETS: readonly number[] = [
	SMALL_BAND,
	MEDIUM_BAND,
	LARGE_BAND,
].flatMap(ceilingRange)

export function ceilingLabel(tokens: number): string {
	return `${tokens / TOKENS_PER_THOUSAND}k`
}

export function ceilingMatches(tokens: number, digits: string): boolean {
	return (
		ceilingLabel(tokens).startsWith(digits) ||
		String(tokens).startsWith(digits)
	)
}

export function parseCeiling(argument: string): number {
	const match = /^(\d+)(k)?$/i.exec(argument.trim())
	if (!match)
		throw new Error(
			'Use /context-budget, status, checkpoint, or a token limit such as 192k or 192000.',
		)
	const [, digits, kiloSuffix] = match
	return Number(digits) * (kiloSuffix ? TOKENS_PER_THOUSAND : 1)
}
