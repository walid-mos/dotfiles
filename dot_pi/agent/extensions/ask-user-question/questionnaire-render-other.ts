import { visibleWidth } from '@earendil-works/pi-tui'

import { INSET } from '../ui/align.ts'
import { uiTheme as theme } from '../ui/design-system/theme.ts'
import { highlightRow } from '../ui/frame.ts'

import { ANSWER_PREVIEW_MAX_LENGTH, UI_TEXT } from './questionnaire-model.ts'

import type { QuestionnaireCanvas } from './questionnaire-render-primitives.ts'

/** A "Type something." row keyed by its marker prefix and cursor focus. */
interface OtherRowView {
	rowPrefix: string
	isCursor: boolean
}

/** The synthetic "Type something." option row of a free-answer question. */
export function renderOtherRow(
	canvas: QuestionnaireCanvas,
	view: OtherRowView,
): void {
	if (!canvas.state.editorHasFocus()) {
		renderOtherPreviewRow(canvas, view)
		return
	}
	renderOtherEditorRow(canvas, view)
}

/** Unfocused "Type something." row: shows the typed draft, if any. */
function renderOtherPreviewRow(
	canvas: QuestionnaireCanvas,
	view: OtherRowView,
): void {
	const { width, sink, state } = canvas
	const preview = state.typedPreview(ANSWER_PREVIEW_MAX_LENGTH)
	const content = preview
		? theme.fg('muted', preview)
		: theme.fg(
				view.isCursor ? 'text' : 'muted',
				view.isCursor
					? theme.bold(UI_TEXT.otherOptionLabel)
					: UI_TEXT.otherOptionLabel,
			)
	const row = `${view.rowPrefix}${content}`
	sink(view.isCursor ? highlightRow(row, width) : row)
}

/** Focused editor body typed inline at the option row indentation. */
function renderOtherEditorRow(
	canvas: QuestionnaireCanvas,
	view: OtherRowView,
): void {
	if (!canvas.editor.getText().length) {
		// Focus cue before typing starts; the band drops once text exists.
		canvas.sink(
			highlightRow(
				`${view.rowPrefix}${theme.fg('dim', UI_TEXT.otherPlaceholder)}`,
				canvas.width,
			),
		)
		return
	}
	// No band while typing (it would break on the first row only).
	const continuation = ' '.repeat(visibleWidth(view.rowPrefix))
	const lines = editorBody(
		canvas.editor,
		canvas.width - visibleWidth(view.rowPrefix),
	)
	for (let index = 0; index < lines.length; index++) {
		canvas.sink(
			`${index === 0 ? view.rowPrefix : continuation}${lines[index] ?? ''}`,
		)
	}
}

export function renderOpenEndedEditor(canvas: QuestionnaireCanvas): void {
	if (!canvas.editor.getText().length) {
		canvas.sink(`${INSET}${theme.fg('dim', UI_TEXT.otherPlaceholder)}`)
		return
	}
	const body = editorBody(canvas.editor, canvas.width - INSET.length)
	for (const line of body) canvas.sink(`${INSET}${line}`)
}

/** Pi needs room for a double-cell grapheme plus its reserved cursor cell.
 * Narrower viewports are clipped by the enclosing frame. */
const MIN_EDITOR_WIDTH = 3

/** Editor widget lines, border stripped and trailing spaces trimmed. */
function editorBody(
	editor: QuestionnaireCanvas['editor'],
	width: number,
): string[] {
	return editor
		.render(Math.max(MIN_EDITOR_WIDTH, width))
		.slice(1, -1)
		.map(line => line.replace(/ +$/, ''))
}
