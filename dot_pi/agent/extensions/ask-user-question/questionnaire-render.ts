/**
 * Frame renderer for the questionnaire: progress line, screen dispatch, the
 * open-ended editor, chat affordance, submit review and the help line.
 * Presentation is intentionally BASIC - plain text lines, cursor accent only;
 * the harness-wide visual style comes later (see questionnaire-options.ts).
 */

import { UI_TEXT } from './questionnaire-model.ts'
import { renderOptions } from './questionnaire-options.ts'
import {
	CURSOR_PREFIX,
	CURSOR_PREFIX_WIDTH,
	QUIET_PREFIX,
	pushWrappedWithPrefix,
	truncateSink,
} from './questionnaire-render-kit.ts'

import type { Answer, Question } from './questionnaire-model.ts'
import type {
	QuestionnairePalette,
	QuestionnaireView,
	RenderPass,
} from './questionnaire-render-kit.ts'
import type { QuestionnaireState } from './questionnaire-state.ts'

export function renderQuestionnaire(view: QuestionnaireView): string[] {
	const lines: string[] = []
	const pass: RenderPass = { ...view, sink: truncateSink(lines, view.width) }
	if (pass.state.isMulti) renderProgressLine(pass)
	renderContent(pass)
	pass.sink('')
	pushWrappedWithPrefix(pass.sink, ' ', helpText(pass.state), pass.width)
	return lines
}

/** Where am I: current (or review) label and position within the flow. */
function renderProgressLine(pass: RenderPass): void {
	const { state, theme, sink, width } = pass
	let content: string
	if (state.isOnSubmitTab()) {
		content = `Review (${state.totalTabs}/${state.totalTabs})`
	} else {
		const question = state.currentQuestion()
		if (!question) return
		content = answeredLine(state, question)
	}
	pushWrappedWithPrefix(sink, ' ', theme.fg('dim', content), width)
	sink('')
}

function answeredLine(state: QuestionnaireState, question: Question): string {
	const answered = state.answerFor(question.id)
	const label = `${answered ? '✓ ' : ''}${question.label}`
	return `${label} (${state.tab + 1}/${state.totalTabs})`
}

function renderContent(pass: RenderPass): void {
	const question = pass.state.currentQuestion()
	if (question && !pass.state.isOnSubmitTab()) {
		renderQuestionScreen(pass, question)
		return
	}
	if (pass.state.isOnSubmitTab()) renderSubmitScreen(pass)
}

function renderQuestionScreen(pass: RenderPass, question: Question): void {
	const { state, theme, sink, width } = pass
	const modeHint = question.multiSelect
		? theme.fg('muted', ' (multiple choice)')
		: ''
	pushWrappedWithPrefix(
		sink,
		' ',
		theme.fg('text', question.prompt) + modeHint,
		width,
	)
	sink('')
	if (state.isOpenEnded(question)) renderOpenEndedEditor(pass)
	else renderOptions(pass, question)
	renderChatAction(pass)
}

/** The chat affordance, kept out of the option list; it is selectable only
 * via explicit keys (Ctrl+G / bottom Enter). */
function renderChatAction(pass: RenderPass): void {
	const { state, theme, sink, width } = pass
	sink('')
	const isCursor = state.isChatAction()
	const color = isCursor ? 'accent' : 'muted'
	const prefix = isCursor ? theme.fg('accent', CURSOR_PREFIX) : QUIET_PREFIX
	pushWrappedWithPrefix(
		sink,
		prefix,
		theme.fg(color, 'Chat about this (Ctrl+G)'),
		width,
	)
}

function renderOpenEndedEditor(pass: RenderPass): void {
	const { editor, theme, sink, width } = pass
	sink('')
	pushWrappedWithPrefix(sink, ' ', theme.fg('muted', 'Your answer:'), width)
	if (!editor.getText().length) {
		pushWrappedWithPrefix(
			sink,
			theme.fg('accent', CURSOR_PREFIX),
			theme.fg('dim', UI_TEXT.otherPlaceholder),
			width,
		)
		return
	}
	editor.render(Math.max(1, width - CURSOR_PREFIX_WIDTH)).forEach(line => {
		sink(` ${line}`)
	})
}

function renderSubmitScreen(pass: RenderPass): void {
	const { state, theme, sink, width } = pass
	pushWrappedWithPrefix(sink, ' ', theme.bold('Ready to submit'), width)
	sink('')
	for (const question of pass.questions) {
		const answer = state.answerFor(question.id)
		if (!answer) continue
		pushWrappedWithPrefix(
			sink,
			' ',
			answerSummaryLine(question.label, answer, theme),
			width,
		)
	}
	sink('')
	if (!state.allAnswered()) {
		const missing = `Unanswered: ${state.unansweredLabels().join(', ')}`
		pushWrappedWithPrefix(sink, ' ', theme.fg('warning', missing), width)
		return
	}
	pushWrappedWithPrefix(
		sink,
		' ',
		theme.fg('muted', 'Press Enter to submit'),
		width,
	)
}

function answerSummaryLine(
	questionLabel: string,
	answer: Answer,
	theme: QuestionnairePalette,
): string {
	const wrotePrefix = answer.wasCustom ? '(wrote) ' : ''
	return `${theme.fg('muted', `${questionLabel}: `)}${theme.fg('text', wrotePrefix + answer.label)}`
}

function helpText(state: QuestionnaireState): string {
	const question = state.currentQuestion()
	let context: string
	if (!question || state.isOnSubmitTab()) {
		context = 'Enter submit • Esc cancel'
	} else if (state.editorHasFocus()) {
		context = focusedEditorHelp(state, question)
	} else {
		context = optionListHelp(state, question)
	}
	if (!state.isMulti) return context
	const navigation = state.editorHasFocus()
		? 'Tab/Shift+Tab navigate'
		: 'Tab/←→ navigate'
	return `${navigation} • ${context}`
}

function focusedEditorHelp(
	state: QuestionnaireState,
	question: Question,
): string {
	if (state.isOpenEnded(question))
		return 'Type your answer • Enter submit • Ctrl+G chat • Esc cancel'
	const enterHint = question.multiSelect
		? 'Enter confirm all'
		: 'Enter submit'
	return `Type your answer • ${enterHint} • Ctrl+G chat • ↑↓ leave the input • Esc back to options`
}

function optionListHelp(state: QuestionnaireState, question: Question): string {
	const quickPick = question.multiSelect
		? '1-9 quick toggle'
		: '1-9 quick select'
	if (question.multiSelect) {
		return `j/k or ↑↓ move • Space toggle • ${quickPick} • Enter confirm • Ctrl+G chat • Esc cancel`
	}
	return `j/k or ↑↓ navigate • ${quickPick} • Enter select/chat • Ctrl+G chat • Esc cancel`
}
