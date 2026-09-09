import { DETAIL_INDENT, INSET } from '../ui/align.ts'
import { uiTheme as theme } from '../ui/design-system/theme.ts'
import { GLYPH, selectionMarker } from '../ui/selection-marker.ts'
import { pushWrapped } from '../ui/terminal-text.ts'

import type { Answer } from './questionnaire-model.ts'
import type { QuestionnaireCanvas } from './questionnaire-render-primitives.ts'

/** Review tab: every question re-listed with the answer marked under it. */
export function renderSubmitBody(canvas: QuestionnaireCanvas): void {
	const { state, width, sink } = canvas
	state.allQuestions().forEach((question, index) => {
		if (index > 0) sink('')
		pushWrapped(
			sink,
			INSET,
			`${theme.fg('dim', `[${question.label}]`)} ${theme.fg('text', theme.bold(question.prompt))}`,
			width,
		)
		const answer = state.answerFor(question.id)
		if (!answer) {
			sink(
				`${DETAIL_INDENT}${theme.fg('warning', `${GLYPH.radioOff} unanswered`)}`,
			)
			return
		}
		renderAnswerRows(canvas, answer)
	})
	if (state.allAnswered()) return
	sink('')
	pushWrapped(
		sink,
		INSET,
		theme.fg(
			'warning',
			`${GLYPH.cancel} unanswered: ${state.unansweredLabels().join(', ')}`,
		),
		width,
	)
}

function renderAnswerRows(canvas: QuestionnaireCanvas, answer: Answer): void {
	if (answer.wasCustom) {
		pushAnswerLabelRow(canvas, 'pen', answer.label)
		return
	}
	if (answer.kind === 'multi') {
		for (const label of answer.labels) {
			pushAnswerLabelRow(canvas, 'check', label)
		}
		return
	}
	pushAnswerLabelRow(canvas, 'radio', answer.label)
}

type AnswerGlyph = 'pen' | 'check' | 'radio'

function pushAnswerLabelRow(
	canvas: QuestionnaireCanvas,
	glyph: AnswerGlyph,
	label: string,
): void {
	const prefix = prefixForAnswerGlyph(glyph)
	pushWrapped(
		canvas.sink,
		`${DETAIL_INDENT}${prefix} `,
		theme.fg('text', label),
		canvas.width,
	)
}

function prefixForAnswerGlyph(glyph: AnswerGlyph): string {
	if (glyph === 'pen') return theme.fg('success', GLYPH.pen)
	return selectionMarker({
		kind: glyph === 'check' ? 'multi' : 'single',
		isChecked: true,
	})
}

/** Key hints for what the current tab accepts, most specific first. */
export function helpText(state: QuestionnaireCanvas['state']): string {
	const navigation = navigationHint(state)
	const context = interactionHint(state)
	return navigation ? `${navigation} · ${context}` : context
}

function navigationHint(
	state: QuestionnaireCanvas['state'],
): string | undefined {
	if (!state.isMulti) return undefined
	if (state.editorHasFocus()) {
		return state.canNavigateTabsFromInputEdges()
			? 'tab or ←→ at input edges'
			: 'tab navigate'
	}
	return '←→ navigate'
}

function interactionHint(state: QuestionnaireCanvas['state']): string {
	const question = state.currentQuestion()
	if (!question || state.isOnSubmitTab()) {
		return 'enter submit · esc cancel'
	}
	if (state.isOpenEnded(question)) {
		return 'type · enter submit · ctrl+g chat · esc cancel'
	}
	if (state.editorHasFocus()) {
		return question.multiSelect
			? 'type · enter confirm all · ctrl+g chat · esc back'
			: 'type · enter submit · ctrl+g chat · esc back'
	}
	if (question.multiSelect) {
		return '↑↓ move · space toggle · 1-9 toggle · enter confirm · ctrl+g chat · esc cancel'
	}
	return '↑↓ move · 1-9 select · enter select · ctrl+g chat · esc cancel'
}
