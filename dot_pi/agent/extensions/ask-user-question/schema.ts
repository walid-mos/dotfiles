/**
 * TypeBox schemas for every shape crossing the ask_user_question boundary:
 * tool input from the LLM and the domain persisted into the session file.
 * UI types derive from these (questionnaire-model.ts), so each field has one
 * declared rule set that both boundaries share.
 */

import { Type } from 'typebox'

// ── LLM tool input (validated by pi before the tool runs) ──────────────

const RawQuestionOptionSchema = Type.Object({
	value: Type.Optional(
		Type.String({
			description:
				'The value returned when selected (defaults to label when omitted)',
			minLength: 1,
		}),
	),
	label: Type.String({
		description: 'Short display label for the option',
		minLength: 1,
	}),
	description: Type.Optional(
		Type.String({ description: 'Optional explanation shown below label' }),
	),
	recommended: Type.Optional(
		Type.Boolean({
			description:
				'Mark this option as the recommended choice (shows a badge)',
		}),
	),
})

const RawQuestionSchema = Type.Object({
	id: Type.String({
		description:
			'Stable unique key reused as the answer key; never omit it',
		minLength: 1,
	}),
	label: Type.Optional(
		Type.String({
			description:
				"Short contextual label for tab bar, e.g. 'Scope', 'Priority' (defaults to Q1, Q2)",
			minLength: 1,
		}),
	),
	prompt: Type.String({
		description: 'The full question text to display',
		minLength: 1,
	}),
	options: Type.Optional(
		Type.Array(RawQuestionOptionSchema, {
			description:
				'Available options to choose from (2-5 recommended). Omit for open-ended questions: shows only a free-text editor.',
		}),
	),
	multiSelect: Type.Optional(
		Type.Boolean({
			description:
				'Allow selecting multiple options (Space toggles, Enter confirms)',
		}),
	),
	allowOther: Type.Optional(
		Type.Boolean({
			description: "Allow 'Type something' option (default: true)",
		}),
	),
})

export const AskParams = Type.Object({
	questions: Type.Array(RawQuestionSchema, {
		description:
			"Questions to ask the user. Ask only what's needed: 2-3 is usually enough, 5 max.",
		minItems: 1,
		maxItems: 5,
	}),
})

// ── Canonical domain (UI state and session-file replay) ───────────────

export const OptionSchema = Type.Object({
	value: Type.String({ description: 'Stable value stored for this option' }),
	label: Type.String({ description: 'Displayed option text' }),
	description: Type.Optional(Type.Union([Type.String(), Type.Undefined()])),
	recommended: Type.Optional(Type.Union([Type.Boolean(), Type.Undefined()])),
})

export const QuestionSchema = Type.Object({
	id: Type.String(),
	label: Type.String(),
	prompt: Type.String(),
	options: Type.Array(OptionSchema, { default: [] }),
	allowOther: Type.Boolean({ default: true }),
	multiSelect: Type.Boolean({ default: false }),
})

export const SingleAnswerSchema = Type.Object({
	kind: Type.Literal('single'),
	id: Type.String(),
	label: Type.String(),
	value: Type.String(),
	wasCustom: Type.Boolean(),
	index: Type.Optional(
		Type.Union([
			Type.Number({
				description: '1-based option number for non-custom picks',
			}),
			Type.Undefined(),
		]),
	),
})

export const MultiAnswerSchema = Type.Object({
	kind: Type.Literal('multi'),
	id: Type.String(),
	label: Type.String(),
	value: Type.String(),
	wasCustom: Type.Boolean(),
	labels: Type.Array(Type.String()),
	optionValues: Type.Array(Type.String()),
	customText: Type.Optional(
		Type.Union([
			Type.String({
				description: 'Committed free-text selection, when present',
			}),
			Type.Undefined(),
		]),
	),
})

export const AnswerSchema = Type.Union([SingleAnswerSchema, MultiAnswerSchema])

export const ChatRequestSchema = Type.Object({
	question: QuestionSchema,
	initialState: Type.Object({
		answers: Type.Array(AnswerSchema),
		drafts: Type.Optional(Type.Record(Type.String(), Type.String())),
	}),
})

export const AskResultSchema = Type.Object({
	questions: Type.Array(QuestionSchema),
	answers: Type.Array(AnswerSchema),
	cancelled: Type.Boolean({ default: false }),
	chat: Type.Optional(ChatRequestSchema),
})
