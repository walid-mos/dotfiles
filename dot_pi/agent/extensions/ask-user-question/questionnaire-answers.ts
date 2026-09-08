/**
 * Answer state, assembly and chat-pause persistence for the questionnaire.
 *
 * QuestionnaireSelections owns the three selection maps (answers,
 * multiSelections, drafts): answer construction, selection queries, capture of
 * a serializable snapshot and its validated restore against the CURRENT
 * questions - entries that no longer match are dropped instead of being
 * restored into impossible states.
 */

import { UI_TEXT } from './questionnaire-model.ts'
import { restoreSnapshotInto } from './questionnaire-restore.ts'

import type {
	Answer,
	Question,
	QuestionnaireSnapshot,
	RenderOption,
} from './questionnaire-model.ts'

/** The custom-text field exists only when free text was actually committed. */
function customTextField(
	draft: string | undefined,
): { customText: string } | undefined {
	if (!draft) return undefined
	return { customText: draft }
}

/** MultiSelect answer: every picked option, plus the typed text when present. */
export function buildMultiAnswer(
	question: Question,
	picked: readonly number[],
	draft: string | undefined,
	options: readonly RenderOption[],
): Answer {
	const labels = [...picked].map(index => options[index]?.label ?? '')
	if (draft) labels.push(draft)
	return {
		kind: 'multi',
		id: question.id,
		label: labels.join(', '),
		wasCustom: !picked.length,
		labels,
		...customTextField(draft),
	}
}

/** Serialize the current answers and drafts for a chat pause. */
export function captureSnapshot(
	answers: ReadonlyMap<string, Answer>,
	drafts: ReadonlyMap<string, string>,
): QuestionnaireSnapshot {
	return {
		answers: [...answers.values()],
		drafts: Object.fromEntries(drafts),
	}
}

export class QuestionnaireSelections {
	readonly answers = new Map<string, Answer>()
	readonly multiSelections = new Map<string, Set<number>>()
	readonly drafts = new Map<string, string>()

	constructor(
		questions: readonly Question[],
		snapshot?: QuestionnaireSnapshot,
	) {
		if (!snapshot) return
		restoreSnapshotInto(this, questions, snapshot)
	}

	// --- Queries ---

	answerFor(questionId: string): Answer | undefined {
		return this.answers.get(questionId)
	}

	hasAnswer(questionId: string): boolean {
		return this.answers.has(questionId)
	}

	allAnswered(questions: readonly Question[]): boolean {
		return questions.every(question => this.answers.has(question.id))
	}

	unansweredLabels(questions: readonly Question[]): string[] {
		return questions
			.filter(question => !this.answers.has(question.id))
			.map(question => question.label)
	}

	collectedAnswers(): Answer[] {
		return [...this.answers.values()]
	}

	isChecked(
		question: Question,
		index: number,
		context: { isOther: boolean; hasTypedText: boolean },
	): boolean {
		if (!question.multiSelect) return false
		if (context.isOther) return context.hasTypedText
		return this.multiSelections.get(question.id)?.has(index) ?? false
	}

	/** Where the option cursor lands when entering a question: on the committed
	 * answer when one exists, else on the draft's "Type something." row, else on
	 * the recommended option (positional fallback: 0). */
	entryCursor(question: Question, options: readonly RenderOption[]): number {
		const answered = this.answers.get(question.id)
		if (answered) {
			const index = answerCursorIndex(answered, options)
			if (index >= 0) return index
		}
		if (this.drafts.has(question.id)) {
			const otherIndex = options.findIndex(option => option.isOther)
			if (otherIndex >= 0) return otherIndex
		}
		const recommendedIndex = options.findIndex(option => option.recommended)
		return recommendedIndex >= 0 ? recommendedIndex : 0
	}

	isDrafted(questionId: string): boolean {
		return this.drafts.has(questionId)
	}

	draftOf(questionId: string): string | undefined {
		return this.drafts.get(questionId)
	}

	// --- Mutations ---

	/** Store or clear a draft; undefined keeps the row in its static form. */
	setDraft(questionId: string, text: string | undefined): void {
		if (text) this.drafts.set(questionId, text)
		else this.drafts.delete(questionId)
	}

	/** Semantic for "the user leaves the question": keep in-flight typing, and
	 * keep a committed custom answer's text (it feeds the "Type something." row
	 * on revisit) - clearing the draft would silently erase what the user typed
	 * and submitted, because the shared editor empty its buffer before
	 * onSubmit fired. Only genuinely empty, unanswered questions reset. */
	syncDraftOnLeave(questionId: string, liveText: string): void {
		if (liveText) {
			this.drafts.set(questionId, liveText)
			return
		}
		const answer = this.answers.get(questionId)
		const hasCustomText = Boolean(
			answer && (answer.kind === 'single' || answer.customText),
		)
		if (!hasCustomText) this.drafts.delete(questionId)
	}

	answerSingleOption(
		question: Question,
		option: RenderOption,
		position: number,
	): void {
		this.answers.set(question.id, {
			kind: 'single',
			id: question.id,
			label: option.label,
			wasCustom: false,
			index: position,
		})
	}

	answerOpenEnded(question: Question, text: string): void {
		const answer = text || UI_TEXT.noResponse
		this.answers.set(question.id, {
			kind: 'single',
			id: question.id,
			label: answer,
			wasCustom: true,
		})
	}

	answerCustomText(question: Question, text: string): void {
		this.setDraft(question.id, text)
		this.answers.set(question.id, {
			kind: 'single',
			id: question.id,
			label: text,
			wasCustom: true,
		})
	}

	toggleMulti(questionId: string, index: number): void {
		const selected =
			this.multiSelections.get(questionId) ?? new Set<number>()
		if (selected.has(index)) selected.delete(index)
		else selected.add(index)
		this.multiSelections.set(questionId, selected)
	}

	/** MultiSelect Enter: confirm checked options plus the typed draft.
	 * Returns undefined when nothing is selected at all (no effect). */
	commitMulti(
		question: Question,
		options: readonly RenderOption[],
	): Answer | undefined {
		const selected =
			this.multiSelections.get(question.id) ?? new Set<number>()
		const draft = this.drafts.get(question.id)?.trim()
		const picked = [...selected].toSorted((left, right) => left - right)
		if (!picked.length && !draft) return undefined
		const answer = buildMultiAnswer(question, picked, draft, options)
		this.answers.set(question.id, answer)
		return answer
	}

	/** Serialize the current answers and drafts for a chat pause. */
	captureSnapshot(): QuestionnaireSnapshot {
		return captureSnapshot(this.answers, this.drafts)
	}
}

function answerCursorIndex(
	answer: Answer,
	options: readonly RenderOption[],
): number {
	if (answer.kind === 'single') {
		// Custom single answers have no option cursor; the draft rule handles them.
		if (answer.wasCustom || !answer.index) return -1
		return answer.index - 1 < options.length ? answer.index - 1 : -1
	}
	for (let index = 0; index < options.length; index++) {
		const pickedLabels = answer.labels
		if (pickedLabels.includes(options[index]?.label ?? '')) return index
	}
	return -1
}
