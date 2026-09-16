/**
 * The terminal bytes the picker's keys arrive as.
 *
 * `matchesKey` matches raw input, not the `Key.*` identifiers, so a test that
 * drives the picker sends the same bytes a terminal would.
 */
export const PICKER_KEYS = {
	tab: '\t',
	shiftTab: '\x1b[Z',
	up: '\x1b[A',
	down: '\x1b[B',
	left: '\x1b[D',
	right: '\x1b[C',
	altUp: '\x1b[1;3A',
	altDown: '\x1b[1;3B',
	enter: '\r',
	escape: '\x1b',
	backspace: '\x7f',
} as const
