/** House semantic roles. Raw Catppuccin values live only in palette.ts. */
import { PI_PALETTE } from './palette.ts'
import { backgroundHex, blendHex, foregroundHex } from './terminal-color.ts'

const SELECTED_BG_TINT_RATIO = 0.85

export const UI_COLOR = {
	border: PI_PALETTE.overlay1,
	base: PI_PALETTE.base,
	accent: PI_PALETTE.mauve,
	text: PI_PALETTE.text,
	muted: PI_PALETTE.subtext0,
	dim: PI_PALETTE.overlay0,
	success: PI_PALETTE.green,
	warning: PI_PALETTE.peach,
	danger: PI_PALETTE.red,
	selectedBg: blendHex(
		PI_PALETTE.mauve,
		PI_PALETTE.base,
		SELECTED_BG_TINT_RATIO,
	),
} as const

export interface UiTheme {
	fg(color: keyof typeof UI_COLOR, text: string): string
	bg(color: 'selectedBg', text: string): string
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
