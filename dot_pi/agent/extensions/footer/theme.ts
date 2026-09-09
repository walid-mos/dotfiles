import { PI_PALETTE as LATTE } from '../ui/design-system/palette.ts'

// ── Icons (Nerd Font code points) ─────────────────────────────────────
export const ICONS = {
	model: '\u{f06a9}', // nf-md-robot
	folder: '\u{f07b}', // nf-fa-folder
	branch: '\u{e0a0}', // powerline branch
	thinking: '\u{f0eb}', // nf-fa-lightbulb
	context: '\u{f200}', // nf-fa-pie_chart
	quota: '\u{f0109}', // nf-md-gauge
	reset: '↺',
} as const

// ── Meter glyphs (▰ / ▱ pairs) and layout separators ──────────────────
export const BAR_WIDTH = 8
export const BAR_FULL = '\u25b0' // ▰ filled meter cell
export const BAR_EMPTY = '\u25b1' // ▱ empty meter cell
export const SEP_THIN = '\u2502' // │ quiet vertical separator

export const THINKING_COLORS: Record<string, string> = {
	off: LATTE.overlay1,
	minimal: LATTE.subtext0,
	low: LATTE.sapphire,
	medium: LATTE.blue,
	high: LATTE.mauve,
	xhigh: LATTE.peach,
	max: LATTE.red,
}
