// ── Catppuccin Latte palette (light terminals) ────────────────────────
// Primary text is strong on light backgrounds; surface1 renders empty bar
// cells (visible yet quiet); subtext0 is the quiet-label tier; overlay1 the
// faintest tier, reserved for resets and hints.
export const LATTE = {
	mauve: '#8839ef',
	blue: '#1e66f5',
	sapphire: '#209fb5',
	teal: '#179299',
	green: '#40a02b',
	yellow: '#df8e1d',
	peach: '#fe640b',
	red: '#d20f39',
	text: '#4c4f69',
	surface1: '#9ca0b0',
	subtext0: '#6c6f85',
	overlay1: '#8c8fa1',
} as const

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
