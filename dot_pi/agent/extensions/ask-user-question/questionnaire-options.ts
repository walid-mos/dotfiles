/**
 * Option list rendering for the questionnaire (single/multiSelect rows, the
 * inline "Type something." editor row). Presentation kept BASIC: plain text
 * lines, cursor accent only; the harness-wide visual style comes later.
 */

import { visibleWidth } from '@earendil-works/pi-tui'

import { ANSWER_PREVIEW_MAX_LENGTH, UI_TEXT } from './questionnaire-model.ts'
import {
	CURSOR_PREFIX,
	CURSOR_PREFIX_WIDTH,
	QUIET_PREFIX,
	pushWrappedWithPrefix,
} from './questionnaire-render-kit.ts'

import type { Question, RenderOption } from './questionnaire-model.ts'
import type { RenderPass } from './questionnaire-render-kit.ts'
import type { QuestionnaireState } from './questionnaire-state.ts'

export function renderOptions(pass: RenderPass, question: Question): void {
	const options = pass.state.currentOptions()
	options.forEach((option, index) =>
		renderOptionRow(pass, question, option, index),
	)
}

function renderOptionRow(
	pass: RenderPass,
	question: Question,
	option: RenderOption,
	index: number,
): void {
	const { state, theme, sink, width } = pass
	const isCursor = index === state.cursor
	const prefix = isCursor ? theme.fg('accent', CURSOR_PREFIX) : QUIET_PREFIX
	const rowLabel = `${index + 1}. ${optionRowCheckbox(state, question, option, index)}`
	const color = isCursor ? 'accent' : 'text'

	if (option.isOther) {
		renderOtherRow(pass, rowLabel)
		return
	}
	const recommendedHint = option.recommended
		? theme.fg('muted', ' (recommended)')
		: ''
	pushWrappedWithPrefix(
		sink,
		prefix,
		theme.fg(color, rowLabel + option.label) + recommendedHint,
		width,
	)
	if (option.description) {
		const descriptionIndent = question.multiSelect ? '         ' : '     '
		pushWrappedWithPrefix(
			sink,
			descriptionIndent,
			theme.fg('muted', option.description),
			width,
		)
	}
}

/** "[x] " / "[ ] " prefix for multiSelect rows, empty for single-select. */
function optionRowCheckbox(
	state: QuestionnaireState,
	question: Question,
	option: RenderOption,
	index: number,
): string {
	if (!question.multiSelect) return ''
	const isChecked = state.isChecked(question, index, option.isOther === true)
	return isChecked ? '[x] ' : '[ ] '
}

/** The "Type something." row: focused = the inline editor (keeping the option's
 * "N. ..." label as prefix so the row indents exactly like the others);
 * unfocused = a static row with the typed text. */
function renderOtherRow(pass: RenderPass, rowLabel: string): void {
	const { state, theme, width } = pass
	const isCursorRow = state.cursor === state.currentOptions().length - 1
	if (!isCursorRow || !state.editorHasFocus()) {
		renderStaticOtherRow(pass, rowLabel)
		return
	}
	const rowPrefix = `${theme.fg('accent', CURSOR_PREFIX)}${theme.fg('accent', rowLabel)}`
	renderInlineEditor(
		pass,
		rowPrefix,
		width - visibleWidth(rowPrefix) - CURSOR_PREFIX_WIDTH,
	)
}

function renderStaticOtherRow(pass: RenderPass, rowLabel: string): void {
	const { state, theme, sink, width } = pass
	const isCursor = state.cursor === state.currentOptions().length - 1
	const color = isCursor ? 'accent' : 'text'
	const prefix = isCursor ? theme.fg('accent', CURSOR_PREFIX) : QUIET_PREFIX
	const preview = state.typedPreview(ANSWER_PREVIEW_MAX_LENGTH)
	const shown = preview
		? theme.fg('muted', preview)
		: theme.fg(color, UI_TEXT.otherOptionLabel)
	pushWrappedWithPrefix(
		sink,
		prefix,
		theme.fg(color, rowLabel) + shown,
		width,
	)
}

function renderInlineEditor(
	pass: RenderPass,
	rowPrefix: string,
	contentWidth: number,
): void {
	const { editor, theme, sink } = pass
	const rowLines = editor
		.render(Math.max(1, contentWidth))
		.slice(1, -1) // strip the editor's horizontal border lines
		.map(line => line.replace(/ +$/, '')) // trim right padding
	if (!editor.getText().length) {
		// Empty editor renders only its cursor: placeholder first
		sink(
			`${rowPrefix}${theme.fg('dim', UI_TEXT.otherPlaceholder)}${rowLines[0] ?? ''}`,
		)
		return
	}
	const continuation = ' '.repeat(visibleWidth(rowPrefix))
	rowLines.forEach((line, index) => {
		sink(`${index === 0 ? rowPrefix : continuation}${line}`)
	})
}
