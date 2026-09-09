/**
 * Domain types for the ask_user_question tool, derived from schema.ts so the
 * tool input, the UI state and the replayed session details share one rule
 * set per field. Semantic rules beyond shape (trimming, `Q{i}` fallbacks,
 * uniqueness) live in questionnaire-normalization.ts.
 */

import type { Static } from 'typebox'
import type {
	AnswerSchema,
	AskResultSchema,
	ChatRequestSchema,
	OptionSchema,
	QuestionSchema,
	SingleAnswerSchema,
	MultiAnswerSchema,
} from './schema.ts'

// Domain vocabulary shared by the UI modules (state, render, component).
export const UI_TEXT = {
	otherOptionLabel: 'Type something.',
	otherPlaceholder: 'Type something...',
	noResponse: '(no response)',
} as const

/** Max characters of a typed answer shown on the static "Type something." row. */
export const ANSWER_PREVIEW_MAX_LENGTH = 50

/** An option as stored: a stable value plus its display label. */
export type QuestionOption = Static<typeof OptionSchema>

/** An option row as rendered: a real option, or the synthetic "Type something." row. */
export type RenderOption = QuestionOption & { isOther?: boolean }

export type Question = Static<typeof QuestionSchema>

export type SingleAnswer = Static<typeof SingleAnswerSchema>

export type MultiAnswer = Static<typeof MultiAnswerSchema>

export type Answer = Static<typeof AnswerSchema>

/** Serializable questionnaire state used when returning from a chat pause. */
export type QuestionnaireInitialState = Static<
	typeof ChatRequestSchema
>['initialState']

/** The current question and state needed to resume after chatting with the agent. */
export type QuestionnaireChatRequest = Static<typeof ChatRequestSchema>

export type AskResult = Static<typeof AskResultSchema>
