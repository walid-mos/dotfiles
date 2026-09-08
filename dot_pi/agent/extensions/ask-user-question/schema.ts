/**
 * Typebox schema for the ask_user_question tool parameters.
 *
 * The boundary is deliberately tolerant of LLM payload quirks: question.id
 * is optional (an obvious positional default exists downstream) because
 * models routinely omit redundant fields; `label` does the job of the old
 * `value`, so the duality was dropped entirely. Defaults are applied by
 * normalizeQuestions() in questionnaire-model.ts, kept typebox-free so the
 * boundary logic is testable without hoisted dependencies.
 */

import { Type } from 'typebox'

import type { Static } from 'typebox'

const QuestionOptionSchema = Type.Object({
	label: Type.String({
		description: 'Display label; doubles as the returned value',
	}),
	description: Type.Optional(
		Type.String({ description: 'Optional explanation shown below label' }),
	),
	recommended: Type.Optional(
		Type.Boolean({
			description:
				'Mark this option as the recommended choice (cursor preselects it)',
		}),
	),
})

const QuestionSchema = Type.Object({
	id: Type.Optional(
		Type.String({
			description:
				'Unique identifier for this question (defaults to q1, q2 by position)',
		}),
	),
	label: Type.Optional(
		Type.String({
			description:
				"Short contextual label, e.g. 'Scope', 'Priority' (defaults to Q1, Q2)",
		}),
	),
	prompt: Type.String({ description: 'The full question text to display' }),
	options: Type.Optional(
		Type.Array(QuestionOptionSchema, {
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
	questions: Type.Array(QuestionSchema, {
		description:
			"Questions to ask the user. Ask only what's needed: 2-3 is usually enough, 5 max.",
		maxItems: 8,
	}),
})

export type AskParamsInput = Static<typeof AskParams>
