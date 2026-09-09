import { UI_TEXT } from './questionnaire-model.ts'

import type {
	Answer,
	MultiAnswer,
	Question,
	QuestionnaireInitialState,
	SingleAnswer,
} from './questionnaire-model.ts'

export interface RestoredResponses {
	answers: Map<string, Answer>
	drafts: Map<string, string>
	multiSelections: Map<string, Set<number>>
}

function isOpenEnded(question: Question): boolean {
	return !question.options.length
}

function isAnswerCompatible(question: Question, answer: Answer): boolean {
	if (question.multiSelect !== (answer.kind === 'multi')) return false
	if (answer.kind !== 'single') return multiAnswerCompatible(question, answer)
	if (!answer.wasCustom) {
		return question.options.some(option => option.value === answer.value)
	}
	if (answer.value === UI_TEXT.noResponse) return isOpenEnded(question)
	return isOpenEnded(question) || question.allowOther
}

function multiAnswerCompatible(
	question: Question,
	answer: MultiAnswer,
): boolean {
	const skipsCustomText = !('customText' in answer)
	const respectsCustomText =
		skipsCustomText ||
		(question.allowOther && Boolean(answer.customText?.trim()))
	const hasSelection = answer.optionValues.length > 0 || !skipsCustomText
	return (
		respectsCustomText &&
		hasSelection &&
		new Set(answer.optionValues).size === answer.optionValues.length &&
		answer.optionValues.every(pickedValue =>
			question.options.some(option => option.value === pickedValue),
		)
	)
}

function restoreAnswer(
	question: Question,
	answer: Answer,
	drafts: Map<string, string>,
	multiSelections: Map<string, Set<number>>,
): Answer {
	if (answer.kind !== 'single') {
		return restoreMultiAnswer(question, answer, drafts, multiSelections)
	}
	return restoreSingleAnswer(question, answer, drafts)
}

function restoreSingleAnswer(
	question: Question,
	answer: SingleAnswer,
	drafts: Map<string, string>,
): Answer {
	if (answer.wasCustom) {
		const isOpenBlank =
			isOpenEnded(question) && answer.value === UI_TEXT.noResponse
		if (!isOpenBlank && !drafts.has(question.id)) {
			drafts.set(question.id, answer.value)
		}
		return answer
	}
	const option = question.options.find(
		candidate => candidate.value === answer.value,
	)
	if (!option) return answer
	return {
		...answer,
		label: option.label,
		index: question.options.indexOf(option) + 1,
	}
}

function restoreMultiAnswer(
	question: Question,
	answer: MultiAnswer,
	drafts: Map<string, string>,
	multiSelections: Map<string, Set<number>>,
): MultiAnswer {
	const selected = answer.optionValues.map(pickedValue =>
		question.options.findIndex(option => option.value === pickedValue),
	)
	multiSelections.set(question.id, new Set(selected))
	if (answer.customText && !drafts.has(question.id)) {
		drafts.set(question.id, answer.customText)
	}
	const labels = selected.map(index => question.options[index]?.label ?? '')
	const values = [...answer.optionValues]
	if (answer.customText) {
		labels.push(answer.customText)
		values.push(answer.customText)
	}
	return {
		...answer,
		value: values.join(','),
		label: labels.join(', '),
		wasCustom: !answer.optionValues.length,
		labels,
	}
}

export function restoreResponses(
	questions: Question[],
	initialState?: QuestionnaireInitialState,
): RestoredResponses {
	const answers = new Map<string, Answer>()
	const drafts = new Map<string, string>()
	const multiSelections = new Map<string, Set<number>>()
	if (!initialState) return { answers, drafts, multiSelections }

	for (const [questionId, draft] of Object.entries(
		initialState.drafts ?? {},
	)) {
		const question = questions.find(
			candidate => candidate.id === questionId,
		)
		if (!draft.trim() || !question) continue
		if (isOpenEnded(question) || question.allowOther) {
			drafts.set(questionId, draft)
		}
	}
	for (const answer of initialState.answers) {
		const question = questions.find(candidate => candidate.id === answer.id)
		if (!question || !isAnswerCompatible(question, answer)) continue
		answers.set(
			question.id,
			restoreAnswer(question, answer, drafts, multiSelections),
		)
	}
	return { answers, drafts, multiSelections }
}
