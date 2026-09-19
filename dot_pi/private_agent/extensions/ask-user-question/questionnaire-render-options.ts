import { DETAIL_INDENT, INSET } from '../ui/align.ts'
import { uiTheme as theme } from '../ui/design-system/theme.ts'
import { highlightRow } from '../ui/frame.ts'
import { GLYPH, selectionMarker } from '../ui/selection-marker.ts'
import { pushWrapped } from '../ui/terminal-text.ts'

import {
	renderOpenEndedEditor as renderOpenEnded,
	renderOtherRow,
} from './questionnaire-render-other.ts'

import type { Question, RenderOption } from './questionnaire-model.ts'
import type { QuestionnaireCanvas } from './questionnaire-render-primitives.ts'

/** Chip bar for multi-question dialogs: one chip per question, then submit. */
export function renderTabBar(canvas: QuestionnaireCanvas): void {
	const { state, width, sink } = canvas
	const chips = state.allQuestions().map((question, index) => {
		const answered = state.answerFor(question.id)
		const active = index === state.tab
		const status = answered
			? theme.fg('success', theme.bold(GLYPH.done))
			: theme.fg('dim', GLYPH.radioOff)
		const label = ` ${status} ${question.label} `
		if (active) return selectedChip(label)
		return theme.fg(answered ? 'muted' : 'dim', label)
	})
	const submitChip = submitTabChip(canvas)
	pushWrapped(
		sink,
		INSET,
		[...chips, submitChip].join(theme.fg('dim', ' ')),
		width,
	)
}

/** Solid background pill so the active tab reads as raised. */
function selectedChip(label: string): string {
	return theme.bg('selectedBg', theme.fg('text', theme.bold(label)))
}

function submitTabChip(canvas: QuestionnaireCanvas): string {
	const { state } = canvas
	const canSubmit = state.allAnswered()
	const label = ` ${theme.fg(canSubmit ? 'success' : 'dim', GLYPH.done)} submit `
	if (state.isOnSubmitTab()) return selectedChip(label)
	return theme.fg(canSubmit ? 'muted' : 'dim', label)
}

/** One question tab: prompt, then its option list or an open editor. */
export function renderQuestionBody(canvas: QuestionnaireCanvas): void {
	const question = canvas.state.currentQuestion()
	if (!question) return
	canvas.sink('')
	const pickMany = question.multiSelect
		? theme.fg('dim', '  ·  pick many')
		: ''
	pushWrapped(
		canvas.sink,
		INSET,
		theme.fg('text', theme.bold(question.prompt)) + pickMany,
		canvas.width,
	)
	canvas.sink('')
	if (canvas.state.isOpenEnded(question)) renderOpenEnded(canvas)
	else renderOptions(canvas, question)
	renderChatAction(canvas)
}

function renderOptions(canvas: QuestionnaireCanvas, question: Question): void {
	const options = canvas.state.currentOptions()
	for (let index = 0; index < options.length; index++) {
		const option = options[index]
		if (!option) continue
		renderOptionRow(canvas, question, option, index)
	}
}

function isSingleChecked(
	canvas: QuestionnaireCanvas,
	question: Question,
	option: RenderOption,
	index: number,
): boolean {
	if (question.multiSelect) return false
	const answer = canvas.state.answerFor(question.id)
	if (answer?.kind !== 'single') return false
	if (option.isOther === true) return answer.wasCustom
	if (answer.wasCustom) return false
	return answer.index === index + 1 || answer.value === option.value
}

function renderOptionRow(
	canvas: QuestionnaireCanvas,
	question: Question,
	option: RenderOption,
	index: number,
): void {
	const isCursor = index === canvas.state.cursor
	const isOther = option.isOther === true
	const isChecked = question.multiSelect
		? canvas.state.isChecked(question, index, option)
		: isSingleChecked(canvas, question, option, index)
	const marker = selectionMarker({
		kind: question.multiSelect ? 'multi' : 'single',
		isChecked,
	})
	const number = theme.fg('dim', `${index + 1}.`)
	const rowPrefix = `${marker} ${number} `
	if (isOther) {
		renderOtherRow(canvas, { rowPrefix, isCursor })
		return
	}

	const label = theme.fg(
		'text',
		isCursor ? theme.bold(option.label) : option.label,
	)
	const badge = option.recommended
		? theme.fg('success', ` ${GLYPH.star} recommended`)
		: ''
	const row = `${rowPrefix}${label}${badge}`
	canvas.sink(isCursor ? highlightRow(row, canvas.width) : row)
	if (option.description) {
		pushWrapped(
			canvas.sink,
			`${DETAIL_INDENT}${theme.fg('dim', GLYPH.desc)} `,
			theme.fg('dim', option.description),
			canvas.width,
		)
	}
}

/** ctrl+g chat affordance row under the option list. */
function renderChatAction(canvas: QuestionnaireCanvas): void {
	canvas.sink('')
	const isCursor = canvas.state.isChatAction()
	const marker = theme.fg(
		isCursor ? 'accent' : 'dim',
		isCursor ? GLYPH.radioOn : GLYPH.radioOff,
	)
	const prompt = theme.fg(isCursor ? 'accent' : 'muted', 'Chat about this')
	const row = `${marker} ${prompt}${theme.fg('dim', '  ·  ctrl+g')}`
	canvas.sink(isCursor ? highlightRow(row, canvas.width) : row)
}
