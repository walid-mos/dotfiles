import { uiTheme } from './design-system/theme.ts'

/** Geometric checkbox glyphs remain legible in the same fonts as radios. */
export const GLYPH = {
	radioOn: '◉',
	radioOff: '○',
	checkOn: '▣',
	checkOff: '□',
	desc: '↳',
	star: '★',
	pen: '✎',
	done: '✔',
	cancel: '✗',
	chat: '⌨',
	enter: '↵',
} as const

interface SelectionMarker {
	kind: 'single' | 'multi'
	isChecked: boolean
}

/** Identical selection contrast in live controls and transcript replays. */
export function selectionMarker(selection: SelectionMarker): string {
	if (selection.kind === 'multi') {
		return selection.isChecked
			? uiTheme.fg('success', uiTheme.bold(GLYPH.checkOn))
			: uiTheme.fg('muted', GLYPH.checkOff)
	}
	return selection.isChecked
		? uiTheme.fg('success', uiTheme.bold(GLYPH.radioOn))
		: uiTheme.fg('dim', GLYPH.radioOff)
}
