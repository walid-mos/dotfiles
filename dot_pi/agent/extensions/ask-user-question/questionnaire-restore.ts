/**
 * Validated restore of a chat-pause snapshot into QuestionnaireSelections.
 *
 * Only a TYPE dependency on the selections class (runtime-free cycle): writes
 * through the public maps. Every entry is validated against the CURRENT
 * questions - answers and drafts that no longer match are dropped instead of
 * being restored into impossible states.
 */

import { UI_TEXT } from './questionnaire-model.ts'

import type { QuestionnaireSelections } from './questionnaire-answers.ts'
import type {
	Answer,
	Question,
	QuestionnaireSnapshot,
	SingleAnswer,
} from './questionnaire-model.ts'

export function restoreSnapshotInto(
	selections: QuestionnaireSelections,
	questions: readonly Question[],
	snapshot: QuestionnaireSnapshot,
): void {
	seedDrafts(selections.drafts, questions, snapshot.drafts ?? {})
	for (const answer of snapshot.answers)
		restoreAnswer(selections, questions, answer)
}

function isOpenEnded(question: Question): boolean {
	return !question.options.length
}

function seedDrafts(
	drafts: Map<string, string>,
	questions: readonly Question[],
	savedDrafts: Record<string, string>,
): void {
	for (const [questionId, draft] of Object.entries(savedDrafts)) {
		const question = questions.find(
			candidate => candidate.id === questionId,
		)
		if (
			draft.trim() &&
			question &&
			(isOpenEnded(question) || question.allowOther)
		)
			drafts.set(questionId, draft)
	}
}

function restoreAnswer(
	selections: QuestionnaireSelections,
	questions: readonly Question[],
	answer: Answer,
): void {
	const question = questions.find(candidate => candidate.id === answer.id)
	if (!question || !isAnswerCompatible(question, answer)) return
	if (answer.kind === 'single') {
		restoreSingleAnswer(selections, question, answer)
		return
	}
	restoreMultiAnswer(selections, question, answer)
}

function isAnswerCompatible(question: Question, answer: Answer): boolean {
	if (question.multiSelect !== (answer.kind === 'multi')) return false
	if (answer.kind === 'single') {
		if (!answer.wasCustom)
			return question.options.some(
				option => option.label === answer.label,
			)
		if (answer.label === UI_TEXT.noResponse) return isOpenEnded(question)
		return isOpenEnded(question) || question.allowOther
	}
	return isMultiAnswerCompatible(question, answer)
}

/** Every label must resolve to an option of the question (duplicates collapse). */
function isMultiAnswerCompatible(
	question: Question,
	answer: Extract<Answer, { kind: 'multi' }>,
): boolean {
	const hasCustomText = Boolean(answer.customText)
	if (!answer.labels.length && !hasCustomText) return false
	if (
		hasCustomText &&
		answer.customText &&
		!(question.allowOther && answer.customText.trim().length)
	) {
		return false
	}
	return pickedIndices(question, answer).length > 0 || hasCustomText
}

/** Indices of options whose label appears in `labels`, first match wins. */
function pickedIndices(
	question: Question,
	answer: Extract<Answer, { kind: 'multi' }>,
): number[] {
	const indices: number[] = []
	for (const label of answer.labels) {
		if (label === answer.customText) continue
		const index = question.options.findIndex(
			option => option.label === label,
		)
		if (index >= 0 && !indices.includes(index)) indices.push(index)
	}
	return indices
}

/** Custom single answers double as drafts so the editor shows the text again. */
function restoreSingleAnswer(
	selections: QuestionnaireSelections,
	question: Question,
	answer: SingleAnswer,
): void {
	if (answer.wasCustom) {
		const isNoResponse =
			isOpenEnded(question) && answer.label === UI_TEXT.noResponse
		if (!isNoResponse && !selections.drafts.has(question.id)) {
			selections.drafts.set(question.id, answer.label)
		}
		selections.answers.set(question.id, answer)
		return
	}
	const option = question.options.find(
		candidate => candidate.label === answer.label,
	)
	if (!option) {
		selections.answers.set(question.id, answer)
		return
	}
	selections.answers.set(question.id, {
		...answer,
		label: option.label,
		index: question.options.indexOf(option) + 1,
	})
}

function restoreMultiAnswer(
	selections: QuestionnaireSelections,
	question: Question,
	answer: Extract<Answer, { kind: 'multi' }>,
): void {
	selections.multiSelections.set(
		question.id,
		new Set(pickedIndices(question, answer)),
	)
	if (answer.customText && !selections.drafts.has(question.id)) {
		selections.drafts.set(question.id, answer.customText)
	}
}
