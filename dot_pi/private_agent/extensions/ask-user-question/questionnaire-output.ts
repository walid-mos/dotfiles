import type { Answer, Question } from './questionnaire-model.ts'

function formatAnswerLine(questionLabel: string, answer: Answer): string {
	if (answer.wasCustom) return `${questionLabel}: user wrote: ${answer.label}`
	if (answer.kind === 'multi' && answer.labels.length > 1) {
		return `${questionLabel}: user selected multiple: ${answer.labels.join(', ')}`
	}
	const prefix =
		answer.kind === 'single' && answer.index ? `${answer.index}. ` : ''
	return `${questionLabel}: user selected: ${prefix}${answer.label}`
}

export function formatAnswerLines(
	questions: Question[],
	answers: Answer[],
): string {
	const labels = new Map(
		questions.map(question => [question.id, question.label]),
	)
	return answers
		.map(answer =>
			formatAnswerLine(labels.get(answer.id) ?? answer.id, answer),
		)
		.join('\n')
}

export function questionnaireKey(questions: Question[]): string {
	return JSON.stringify(questions)
}

export function chatFollowUp(question: Question): string {
	return [
		`The user paused the questionnaire to discuss "${question.label}": ${question.prompt}`,
		'Explain the trade-offs and answer their questions in normal chat. Do not reopen the questionnaire or choose for them in this turn. Leave the conversation open; resume the same questionnaire only after the user explicitly says they are ready to answer.',
	].join('\n')
}
