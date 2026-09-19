/**
 * model-fallback - the reasoning column the session list, the inline agent
 * editor and the agents list share: the level squares and the level's own name.
 *
 * Which level a row shows is each surface's decision (a pending edit, a pin, a
 * scope entry or the session). How it is drawn is decided here once, so the
 * three lists stay one design. A row with no level set is never "auto": a
 * non-reasoning model runs `off` (pi clamps every one of them to it), and a
 * reasoning model inherits whatever level drives it.
 */

import { uiTheme } from '../ui/design-system/theme.ts'

import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import type { CatalogRow } from './model-catalog.ts'

/** Below this width the squares have to speak for the level alone. */
const EFFORT_NAME_WIDTH = 72
const EFFORT_FILLED = '▪'
const EFFORT_EMPTY = '▫'
const LEVEL_NAME_WIDTH = 7
/** What the column says when the catalogue cannot report the model's levels. */
const UNKNOWN_MODEL = 'unknown model'
/** What it says when nothing is set and the model could reason. */
const INHERITED = 'inherit'
/** What it says beside a stored level the model does not accept. */
const UNSUPPORTED = 'unsupported'
/** The same state when the column has no room for the word. */
const UNSUPPORTED_MARK = '!'

export interface EffortDisplay {
	/** The model whose levels apply; undefined when the catalogue cannot say. */
	row: CatalogRow | undefined
	/** The level that applies, when one is set. */
	level: ModelThinkingLevel | undefined
	/** An unsaved edit wears the accent ink. */
	isPending?: boolean
	/**
	 * A level this model does not accept, shown because it is stored: the row
	 * says so instead of hiding the value behind an inherited level.
	 */
	isUnsupported?: boolean
}

function effortSquare(isReached: boolean): string {
	return isReached
		? uiTheme.fg('muted', EFFORT_FILLED)
		: uiTheme.fg('dim', EFFORT_EMPTY)
}

/** The level's name and ink: pending, chosen, inherited or pi's clamped off. */
function levelName(display: EffortDisplay): {
	text: string
	ink: 'accent' | 'muted' | 'dim'
} {
	if (display.level)
		return {
			text: display.level,
			ink: display.isPending ? 'accent' : 'muted',
		}
	// `getSupportedThinkingLevels` reports off alone for a non-reasoning
	// model: that *is* the level pi runs it at, so the row says so.
	if (display.row && display.row.levels.length <= 1)
		return { text: 'off', ink: 'dim' }
	return { text: INHERITED, ink: 'dim' }
}

/** The shared reasoning column: filled squares up to the level, then its name. */
export function effortBlock(display: EffortDisplay, width: number): string {
	if (!display.row) return uiTheme.fg('dim', UNKNOWN_MODEL)
	const reached = display.level
		? display.row.levels.indexOf(display.level)
		: -1
	const squares = display.row.levels
		.map((_, index) => effortSquare(index <= reached))
		.join('')
	if (width < EFFORT_NAME_WIDTH) {
		if (!display.isUnsupported) return squares
		return `${squares} ${uiTheme.fg('warning', UNSUPPORTED_MARK)}`
	}
	const name = levelName(display)
	const mark = display.isUnsupported
		? ` ${uiTheme.fg('warning', UNSUPPORTED)}`
		: ''
	return `${squares} ${uiTheme.fg(name.ink, name.text.padStart(LEVEL_NAME_WIDTH))}${mark}`
}
