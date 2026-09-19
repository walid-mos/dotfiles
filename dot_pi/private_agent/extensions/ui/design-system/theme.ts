/** House semantic roles. Raw Catppuccin values live only in palette.ts. */
import { PI_PALETTE } from './palette.ts'
import { backgroundHex, blendHex, foregroundHex } from './terminal-color.ts'

const SELECTED_BG_TINT_RATIO = 0.85
const DIFF_BG_TINT_RATIO = 0.1
const MUTATION_BORDER_STRENGTH = 0.6

export const UI_COLOR = {
	border: PI_PALETTE.overlay1,
	/** Chain rail glyph ink: the one structural hue, cooler than muted. */
	rail: PI_PALETTE.blue,
	base: PI_PALETTE.base,
	mutationBorder: blendHex(
		PI_PALETTE.base,
		PI_PALETTE.mauve,
		MUTATION_BORDER_STRENGTH,
	),
	accent: PI_PALETTE.mauve,
	text: PI_PALETTE.text,
	muted: PI_PALETTE.subtext0,
	dim: PI_PALETTE.overlay0,
	/** Tool result bodies: one step brighter than muted, quieter than text. */
	output: PI_PALETTE.subtext1,
	success: PI_PALETTE.green,
	warning: PI_PALETTE.peach,
	danger: PI_PALETTE.red,
	diffAddedBg: blendHex(
		PI_PALETTE.base,
		PI_PALETTE.green,
		DIFF_BG_TINT_RATIO,
	),
	diffRemovedBg: blendHex(
		PI_PALETTE.base,
		PI_PALETTE.red,
		DIFF_BG_TINT_RATIO,
	),
	selectedBg: blendHex(
		PI_PALETTE.mauve,
		PI_PALETTE.base,
		SELECTED_BG_TINT_RATIO,
	),
	/** Skill callout ink: a pink identity that no other surface uses. */
	skill: PI_PALETTE.pink,
} as const

/** Skill callout band background at a 0..1 rose ratio: 0 is transparent, 1 is full pink. */
export function skillBandHex(ratio: number): string {
	return blendHex(PI_PALETTE.base, PI_PALETTE.pink, ratio)
}

export interface UiTheme {
	fg(color: keyof typeof UI_COLOR, text: string): string
	bg(
		color: 'selectedBg' | 'diffAddedBg' | 'diffRemovedBg',
		text: string,
	): string
	bold(text: string): string
	/** Quiet a color without changing its hue: the same tone, one step back. */
	faint(text: string): string
}

const BOLD = '\x1b[1m'
const BOLD_OFF = '\x1b[22m'
const FAINT = '\x1b[2m'
const FAINT_OFF = '\x1b[22m'

export const uiTheme: UiTheme = {
	fg: (color, text) => foregroundHex(UI_COLOR[color], text),
	bg: (color, text) => backgroundHex(UI_COLOR[color], text),
	bold: text => `${BOLD}${text.replaceAll(BOLD_OFF, BOLD)}${BOLD_OFF}`,
	faint: text => `${FAINT}${text.replaceAll(FAINT_OFF, FAINT)}${FAINT_OFF}`,
}
