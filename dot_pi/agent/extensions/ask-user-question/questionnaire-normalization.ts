import type { Static } from 'typebox'
import type { Question, QuestionOption } from './questionnaire-model.ts'
import type { AskParams } from './schema.ts'

export type RawQuestion = Static<typeof AskParams>['questions'][number]
type RawQuestionOption = NonNullable<RawQuestion['options']>[number]

function requiredText(text: string, field: string): string {
	const normalized = text.trim()
	if (!normalized) throw new Error(`${field} must not be blank`)
	return normalized
}

function optionDescription(text: string | undefined): string | undefined {
	const description = text?.trim()
	if (!description) return undefined
	return description
}

function normalizeOptions(
	questionId: string,
	rawOptions: RawQuestionOption[],
): QuestionOption[] {
	const committedValues = new Set<string>()
	return rawOptions.map((option, index) => {
		const label = requiredText(
			option.label,
			`Question "${questionId}" option ${index + 1} label`,
		)
		const optionValue = requiredText(
			option.value ?? label,
			`Question "${questionId}" option ${index + 1} value`,
		)
		if (committedValues.has(optionValue)) {
			throw new Error(
				`Question "${questionId}" has duplicate option value "${optionValue}"`,
			)
		}
		committedValues.add(optionValue)
		return {
			value: optionValue,
			label,
			description: optionDescription(option.description),
			recommended: option.recommended,
		}
	})
}

/** Map validated tool arguments into the stricter questionnaire domain. */
export function normalizeQuestions(raw: RawQuestion[]): Question[] {
	const ids = new Set<string>()
	return raw.map((question, index) => {
		const id = requiredText(question.id, `Question ${index + 1} id`)
		if (ids.has(id)) throw new Error(`Duplicate question id "${id}"`)
		ids.add(id)
		const options = normalizeOptions(id, question.options ?? [])
		return {
			id,
			label: requiredText(
				question.label ?? `Q${index + 1}`,
				'Question label',
			),
			prompt: requiredText(question.prompt, `Question "${id}" prompt`),
			options,
			allowOther: question.allowOther !== false,
			multiSelect: options.length > 0 && question.multiSelect === true,
		}
	})
}
