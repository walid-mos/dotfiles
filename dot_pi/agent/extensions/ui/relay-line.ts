/** Shared authored RELAY glyph colors for raw user lines and response Markdown text tokens.
 *
 * Rail lines wear house semantic colors so the rail reads at a glance:
 *
 *   - state light / verdict glyph: ● ✓ success · ◐ warning · ◇ dim · ✕ danger
 *   - markers ❯ (task header) and ▸ (details footer): accent
 *   - connectors ├─ └─ │ ╭ ╰ and dot-leader runs ····: muted
 *
 * Everything else in the line (verbs, commands, metrics) stays house text
 * ink. A line qualifies only when it starts with a rail marker, so prose and
 * code fences pass through byte-for-byte unchanged. Pure string function:
 * no TUI, no theme hot-reload coupling beyond the design-system import. */
import { uiTheme } from './design-system/theme.ts'

import type { UI_COLOR } from './design-system/theme.ts'

type ColorName = keyof typeof UI_COLOR

/** A rail line: rail marker, card frame, header/footer marker, state light
 * or verdict glyph in the first columns. */
const RAIL_LINE = /^\s*(?:├─|└─|│|❯|▸|╭|╰|●|◐|◇|✓|✕)/

/** Left-to-right; each pass inserts ANSI codes whose bytes never match a
 * later pattern, so ordering is not correctness-critical. */
const PAINTS: readonly (readonly [RegExp, ColorName])[] = [
	[/·/g, 'muted'],
	[/[├└]─|│|╭|╰/g, 'muted'],
	[/─{3,}/g, 'muted'],
	[/❯|▸/g, 'accent'],
	[/●|✓/g, 'success'],
	[/◐/g, 'warning'],
	[/◇/g, 'dim'],
	[/✕/g, 'danger'],
]

/** House-colored RELAY rail line; identical string otherwise. */
export function colorizeRailLine(line: string): string {
	if (!RAIL_LINE.test(line)) return line
	let painted = line
	for (const [pattern, color] of PAINTS) {
		painted = painted.replace(pattern, glyph => uiTheme.fg(color, glyph))
	}
	return painted
}
