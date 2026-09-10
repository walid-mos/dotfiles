/**
 * Editor top-border hook: our working loader lives in the border, the way pi's
 * default loader does - same left alignment - and the activity block sits inside
 * that border instead of occupying a line of its own under it.
 *
 * The block wears the loading color: pi paints the embedded spinner and its
 * message with the editor's own border color, and the numbers, tally icons and
 * clock mark take that same hue, so the block and the loader read as one. Its
 * words stay muted - house ink quieted toward the background - and the elapsed
 * track carries the border hue with them.
 *
 * Alignment is stable by construction: the block is flush with the border's
 * right edge, and its own width is fixed for a given border width, so neither a
 * growing count nor a rotating loader message can move it. The loader field the
 * budget reserves is the house maximum (`EMBEDDED_LOADER_FIELD_WIDTH`); a
 * message wider than that reserve pushes the block instead of being overwritten,
 * and a border without room for both simply keeps the block out of the way.
 */

import { stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui'

import { blendHex, foregroundHex } from '../ui/design-system/terminal-color.ts'
import { UI_COLOR } from '../ui/design-system/theme.ts'
import { EMBEDDED_LOADER_FIELD_WIDTH } from '../ui/editor-decorator.ts'
import { truncateTerminalLine } from '../ui/terminal-text.ts'

import type { EditorComponent } from '@earendil-works/pi-tui'
import type { ActivityPaint } from './render.ts'

/** The slice of the editor this hook rebinds. */
export type ActivityBorderHost = Pick<EditorComponent, 'render' | 'borderColor'>

/** Renders the activity block for a width budget, or nothing while inactive. */
export type ActivityReader = (
	maxWidth: number,
	paint: ActivityPaint,
) => string | undefined

/** Where the block may sit: the border width, and the columns reserved for the loader. */
export type ActivitySlot = {
	readonly width: number
	readonly loaderWidth: number
}

/**
 * Tones measured from the house `muted` ink toward the background. The words
 * live at `CHROME_QUIET_RATIO`; `DATA_QUIET_RATIO` is the numbers' fallback for
 * an editor that exposes no border color - the loading color is preferred, and
 * at the low thinking levels that color is pale, which is the point.
 */
const DATA_QUIET_RATIO = 0.35
const CHROME_QUIET_RATIO = 0.45
const DATA_TONE = blendHex(UI_COLOR.muted, UI_COLOR.base, DATA_QUIET_RATIO)
const CHROME_TONE = blendHex(UI_COLOR.muted, UI_COLOR.base, CHROME_QUIET_RATIO)

const BORDER_DASH = '─'
/** Dashes kept before and after the block, so it never touches the loader or the edge. */
const MIN_SIDE_DASHES = 1
/** Both sides together: free columns the block must leave in the border. */
const MIN_FREE_MARGIN = 2

export function installActivityBorder(
	editor: ActivityBorderHost,
	readActivity: ActivityReader,
): void {
	const paint = createActivityPaint(() => editor.borderColor)
	const renderEditor = editor.render.bind(editor)
	// oxlint-disable-next-line no-param-reassign
	editor.render = (width: number): string[] => {
		const lines = renderEditor(width)
		const [border] = lines
		if (!border) return lines
		const slot: ActivitySlot = {
			width,
			loaderWidth: EMBEDDED_LOADER_FIELD_WIDTH,
		}
		const activity = readActivity(slotBudget(slot), paint)
		if (!activity) return lines
		return [
			composeActivityBorder(border, activity, slot, editor.borderColor),
			...lines.slice(1),
		]
	}
}

/**
 * The loading color for the readings - pi paints the embedded spinner and its
 * message with the editor's border color - muted house ink for the words, and
 * the same border color for the track. The color is read per frame: pi
 * reassigns it whenever the thinking level changes.
 */
export function createActivityPaint(
	readBorderColor: () => ((text: string) => string) | undefined,
): ActivityPaint {
	const loadingColor = (text: string): string =>
		(readBorderColor() ?? (content => foregroundHex(DATA_TONE, content)))(
			text,
		)
	return {
		data: loadingColor,
		chrome: text => foregroundHex(CHROME_TONE, text),
		track: loadingColor,
	}
}

/**
 * Flush with the border's right edge, dashes filling the space the loader leaves.
 * Returns the border untouched when it is not a pi border line, when the block
 * does not fit the reserved space, or when the loader on screen left no room.
 */
export function composeActivityBorder(
	border: string,
	activity: string,
	slot: ActivitySlot,
	borderColor: ((text: string) => string) | undefined,
): string {
	const free = trailingDashWidth(border)
	const blockWidth = visibleWidth(activity)
	if (free === 0 || blockWidth > slotBudget(slot)) return border
	const offset = slot.width - MIN_SIDE_DASHES - blockWidth
	// Content pi splices into the dash run (a scrolled editor's `↑ N more` label,
	// or a loader wider than the reserve) may only push the block, never lose.
	const earliest = slot.width - free + MIN_SIDE_DASHES
	if (earliest > offset) return border
	const trailing = (borderColor ?? identity)(
		BORDER_DASH.repeat(slot.width - offset - blockWidth),
	)
	return truncateTerminalLine(border, offset) + activity + trailing
}

/** Columns the block may use: everything the loader reserve leaves, less its margins. */
function slotBudget(slot: ActivitySlot): number {
	return slot.width - slot.loaderWidth - MIN_FREE_MARGIN
}

/** Free space pi leaves on a border line: the width of its trailing dash run. */
function trailingDashWidth(border: string): number {
	const plain = stripTerminalSequences(border).trimEnd()
	let dashes = 0
	while (
		dashes < plain.length &&
		plain[plain.length - 1 - dashes] === BORDER_DASH
	) {
		dashes += 1
	}
	return dashes
}

function identity(text: string): string {
	return text
}
