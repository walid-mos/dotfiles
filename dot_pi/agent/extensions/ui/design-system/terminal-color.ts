/** Validated #rrggbb colors, linear blending and nest-safe truecolor styling. */
export type RgbColor = readonly [number, number, number]

const HEX_COLOR = /^#[\da-f]{6}$/iu
const HEX_RADIX = 16
const CHANNEL_DIGITS = 2
const CHANNEL_OFFSET = { red: 1, green: 3, blue: 5 } as const
const FOREGROUND_RESET = '\x1b[39m'
const BACKGROUND_RESET = '\x1b[49m'
const STYLE_RESET = '\x1b[0m'

export function hexToRgb(hex: string): RgbColor {
	if (!HEX_COLOR.test(hex)) {
		throw new TypeError(
			`Expected #rrggbb color, received ${JSON.stringify(hex)}`,
		)
	}
	return [
		parseInt(
			hex.slice(CHANNEL_OFFSET.red, CHANNEL_OFFSET.red + CHANNEL_DIGITS),
			HEX_RADIX,
		),
		parseInt(
			hex.slice(
				CHANNEL_OFFSET.green,
				CHANNEL_OFFSET.green + CHANNEL_DIGITS,
			),
			HEX_RADIX,
		),
		parseInt(
			hex.slice(
				CHANNEL_OFFSET.blue,
				CHANNEL_OFFSET.blue + CHANNEL_DIGITS,
			),
			HEX_RADIX,
		),
	]
}

function channelToHex(channel: number): string {
	return Math.round(channel).toString(HEX_RADIX).padStart(CHANNEL_DIGITS, '0')
}

export function rgbToHex([red, green, blue]: RgbColor): string {
	return `#${channelToHex(red)}${channelToHex(green)}${channelToHex(blue)}`
}

/** Ratio 0 keeps `from`, ratio 1 reaches `to`. */
export function blendHex(from: string, to: string, ratio: number): string {
	const [red, green, blue] = hexToRgb(from)
	const [toRed, toGreen, toBlue] = hexToRgb(to)
	return rgbToHex([
		red + (toRed - red) * ratio,
		green + (toGreen - green) * ratio,
		blue + (toBlue - blue) * ratio,
	])
}

export function foregroundHex(hex: string, text: string): string {
	const start = `\x1b[38;2;${hexToRgb(hex).join(';')}m`
	return `${start}${text.replaceAll(FOREGROUND_RESET, start).replaceAll(STYLE_RESET, STYLE_RESET + start)}${FOREGROUND_RESET}`
}

export function backgroundHex(hex: string, text: string): string {
	const start = `\x1b[48;2;${hexToRgb(hex).join(';')}m`
	return `${start}${text.replaceAll(BACKGROUND_RESET, start).replaceAll(STYLE_RESET, STYLE_RESET + start)}${BACKGROUND_RESET}`
}
