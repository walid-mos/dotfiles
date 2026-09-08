/**
 * Domain model for the ask_user_question tool.
 *
 * Two layers, mapped at the boundary by normalizeQuestions():
 * - AskParamsInput: what the LLM sends, validated by schema.ts (infrastructure).
 * - Question/Answer/AskResult: the normalized domain the UI works with.
 */

// Domain vocabulary shared by the UI modules (snapshot, state, render, component).
export const UI_TEXT = {
	otherOptionLabel: 'Type something.',
	otherPlaceholder: 'Type something...',
	noResponse: '(no response)',
} as const

/** Max characters of a typed answer shown on the static "Type something." row. */
export const ANSWER_PREVIEW_MAX_LENGTH = 50

export interface QuestionOption {
	label: string
	description?: string
	recommended?: boolean
}

/** An option row as rendered: a real option, or the synthetic "Type something." row. */
export type RenderOption = QuestionOption & { isOther?: boolean }

export interface Question {
	id: string
	label: string
	prompt: string
	options: QuestionOption[]
	allowOther: boolean
	multiSelect: boolean
}

export interface AnswerBase {
	id: string
	label: string
	wasCustom: boolean
}

/** Answer to a single-select question; `index` is the 1-based option number for non-custom picks. */
export interface SingleAnswer extends AnswerBase {
	kind: 'single'
	index?: number
}

/** Answer to a multiSelect question: every picked option label, in display
 * order; the committed free-text selection, when present, is the last entry. */
export interface MultiAnswer extends AnswerBase {
	kind: 'multi'
	labels: string[]
	/** The committed free-text selection, when present. */
	customText?: string
}

export type Answer = SingleAnswer | MultiAnswer

/** Serializable questionnaire snapshot captured in serializeSnapshot(). */
export interface QuestionnaireSnapshot {
	answers: Answer[]
	drafts?: Record<string, string>
}

/** The current question and snapshot needed to resume after a chat pause. */
export interface QuestionnaireChatRequest {
	question: Question
	snapshot: QuestionnaireSnapshot
}

export interface AskResult {
	answers: Answer[]
	cancelled: boolean
	chat?: QuestionnaireChatRequest
}

// --- Boundary mapping (raw LLM payload -> domain) ---

/** One option as sent by the model. A stray `value` field in the payload is
 * ignored: `label` IS the value of the option. */
export interface RawQuestionOption {
	label: string
	description?: string
	recommended?: boolean
}

/** A question as sent by the model, before defaults are applied. */
export interface RawQuestion {
	id?: string
	label?: string
	prompt: string
	options?: RawQuestionOption[]
	multiSelect?: boolean
	allowOther?: boolean
}

/** Apply defaults to the raw LLM payload: empty option list, q1/Q labels by
 * position, allowOther on. A `value` field sent by the model anyway is not
 * read: `label` IS the value of the option. */
export function normalizeQuestions(raw: readonly RawQuestion[]): Question[] {
	return raw.map((question, index) => ({
		id: question.id ?? `q${index + 1}`,
		label: question.label ?? `Q${index + 1}`,
		prompt: question.prompt,
		options: (question.options ?? []).map(normalizeOption),
		allowOther: question.allowOther ?? true,
		multiSelect: question.multiSelect ?? false,
	}))
}

function normalizeOption(raw: RawQuestionOption): QuestionOption {
	const option: QuestionOption = {
		label: raw.label,
	}
	if (raw.description) option.description = raw.description
	if (raw.recommended === true) option.recommended = true
	return option
}
