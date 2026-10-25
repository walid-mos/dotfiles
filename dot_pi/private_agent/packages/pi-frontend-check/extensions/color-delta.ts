// Color deltas are decided here by OKLab distance, so Jev never compares color strings.

/** OKLab ΔE at or below which two colors read as the same (the CSS Color 4 JND). */
export const COLOR_MATCH_DELTA_E = 0.02

type Rgb = { red: number; green: number; blue: number }
type Lms = { long: number; medium: number; short: number }
type Oklab = { lightness: number; greenRed: number; blueYellow: number }
type ParsedColor = { oklab: Oklab; alpha: number }
type Channels = readonly [number, number, number]

const CHANNEL_MAX = 255
const CHANNEL_COUNT = 3
const CHANNEL_COUNT_WITH_ALPHA = 4
const DEGREES_PER_HALF_TURN = 180
const SRGB_TRANSFER = {
	linearLimit: 0.04045,
	linearSlope: 12.92,
	offset: 0.055,
	scale: 1.055,
	gamma: 2.4,
} as const
const LINEAR_SRGB_TO_LMS = {
	long: { red: 0.4122214708, green: 0.5363325363, blue: 0.0514459929 },
	medium: { red: 0.2119034982, green: 0.6806995451, blue: 0.1073969566 },
	short: { red: 0.0883024619, green: 0.2817188376, blue: 0.6299787005 },
} as const satisfies Record<keyof Lms, Rgb>
const LMS_TO_OKLAB = {
	lightness: {
		long: 0.2104542553,
		medium: 0.793617785,
		short: -0.0040720468,
	},
	greenRed: { long: 1.9779984951, medium: -2.428592205, short: 0.4505937099 },
	blueYellow: {
		long: 0.0259040371,
		medium: 0.7827717662,
		short: -0.808675766,
	},
} as const satisfies Record<keyof Oklab, Lms>
const OKLAB_BLACK: Oklab = { lightness: 0, greenRed: 0, blueYellow: 0 }
const OKLAB_WHITE: Oklab = { lightness: 1, greenRed: 0, blueYellow: 0 }
const COLOR_TOKEN = /(?:rgba?|oklab|oklch|color)\([^)]*\)|\btransparent\b/g
const COLOR_FUNCTION = /^(?<name>[a-z]+)\((?<body>[^)]*)\)$/

function linearize(channel: number): number {
	const { linearLimit, linearSlope, offset, scale, gamma } = SRGB_TRANSFER
	return channel <= linearLimit
		? channel / linearSlope
		: ((channel + offset) / scale) ** gamma
}

function linearSrgbToLms(rgb: Rgb): Lms {
	const row = (weights: Rgb): number =>
		weights.red * rgb.red +
		weights.green * rgb.green +
		weights.blue * rgb.blue
	return {
		long: row(LINEAR_SRGB_TO_LMS.long),
		medium: row(LINEAR_SRGB_TO_LMS.medium),
		short: row(LINEAR_SRGB_TO_LMS.short),
	}
}

function lmsToOklab(lms: Lms): Oklab {
	const row = (weights: Lms): number =>
		weights.long * Math.cbrt(lms.long) +
		weights.medium * Math.cbrt(lms.medium) +
		weights.short * Math.cbrt(lms.short)
	return {
		lightness: row(LMS_TO_OKLAB.lightness),
		greenRed: row(LMS_TO_OKLAB.greenRed),
		blueYellow: row(LMS_TO_OKLAB.blueYellow),
	}
}

function srgbToOklab([red, green, blue]: Channels): Oklab {
	return lmsToOklab(
		linearSrgbToLms({
			red: linearize(red),
			green: linearize(green),
			blue: linearize(blue),
		}),
	)
}

function oklchToOklab([lightness, chroma, hue]: Channels): Oklab {
	const radians = (hue * Math.PI) / DEGREES_PER_HALF_TURN
	return {
		lightness,
		greenRed: chroma * Math.cos(radians),
		blueYellow: chroma * Math.sin(radians),
	}
}

function fromChannels(
	parts: string[],
	channelMax: number,
	toOklab: (channels: Channels) => Oklab,
): ParsedColor | undefined {
	const numbers = parts.map(part => (part === 'none' ? 0 : Number(part)))
	if (
		numbers.length < CHANNEL_COUNT ||
		numbers.length > CHANNEL_COUNT_WITH_ALPHA ||
		!numbers.every(Number.isFinite)
	)
		return undefined
	const [first = 0, second = 0, third = 0, alpha = 1] = numbers
	return {
		oklab: toOklab([
			first / channelMax,
			second / channelMax,
			third / channelMax,
		]),
		alpha,
	}
}

const COLOR_PARSERS: Record<
	string,
	(parts: string[]) => ParsedColor | undefined
> = {
	rgb: parts => fromChannels(parts, CHANNEL_MAX, srgbToOklab),
	rgba: parts => fromChannels(parts, CHANNEL_MAX, srgbToOklab),
	color: ([space, ...parts]) =>
		space === 'srgb' ? fromChannels(parts, 1, srgbToOklab) : undefined,
	oklab: parts =>
		fromChannels(parts, 1, ([lightness, greenRed, blueYellow]) => ({
			lightness,
			greenRed,
			blueYellow,
		})),
	oklch: parts => fromChannels(parts, 1, oklchToOklab),
}

function parseColor(token: string): ParsedColor | undefined {
	if (token === 'transparent') return { oklab: OKLAB_BLACK, alpha: 0 }
	const groups = COLOR_FUNCTION.exec(token)?.groups
	const parser = COLOR_PARSERS[groups?.name ?? '']
	return parser?.((groups?.body ?? '').split(/[\s,/]+/).filter(Boolean))
}

function blendOver({ oklab, alpha }: ParsedColor, backdrop: Oklab): Oklab {
	const mix = (key: keyof Oklab): number =>
		backdrop[key] + (oklab[key] - backdrop[key]) * alpha
	return {
		lightness: mix('lightness'),
		greenRed: mix('greenRed'),
		blueYellow: mix('blueYellow'),
	}
}

/** The real backdrop is unknown, so translucent colors blend over black and white and the worse case decides. */
function colorDeltaE(first: ParsedColor, second: ParsedColor): number {
	return Math.max(
		...[OKLAB_BLACK, OKLAB_WHITE].map(backdrop => {
			const one = blendOver(first, backdrop)
			const other = blendOver(second, backdrop)
			return Math.hypot(
				one.lightness - other.lightness,
				one.greenRed - other.greenRed,
				one.blueYellow - other.blueYellow,
			)
		}),
	)
}

export type ColorComparison = { deltaE: number; recolored: string }

export function compareColors(
	implementation: string,
	baseline: string,
): ColorComparison | undefined {
	const implementationTokens = implementation.match(COLOR_TOKEN) ?? []
	const baselineTokens = baseline.match(COLOR_TOKEN) ?? []
	if (
		!implementationTokens.length ||
		implementationTokens.length !== baselineTokens.length
	)
		return undefined
	const distances = implementationTokens.map((token, index) => {
		const first = parseColor(token)
		const second = parseColor(baselineTokens[index] ?? '')
		return first && second ? colorDeltaE(first, second) : Number.NaN
	})
	if (!distances.every(Number.isFinite)) return undefined
	let tokenIndex = 0
	const recolored = implementation.replace(
		COLOR_TOKEN,
		() => baselineTokens[tokenIndex++] ?? '',
	)
	return { deltaE: Math.max(...distances), recolored }
}
