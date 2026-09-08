/**
 * Ask User Question tool.
 *
 * Features:
 * - Single or multiple questions (Tab navigation between questions)
 * - Options with descriptions + optional "(recommended)" preselection
 * - Number keys 1-9 for instant selection
 * - multiSelect per question (Space to toggle, Enter to confirm)
 * - Inline free-text editor on the "Type something." row, rendered at the
 *   exact same indentation as any other option
 * - ↑/↓ move the cursor inside the input and leave it at the buffer's edges
 *   (empty input: ↑ leaves immediately); Esc jumps back to the first option
 * - Single-select submits in one Enter from the editor; multiSelect combines
 *   checked options with the typed text in a single Enter
 * - Open-ended questions: omit options to show only a free-text editor
 * - Cursor pre-positioned on the recommended option
 * - Free-text drafts preserved when navigating between questions
 * - Review/submit screen for multi-question flows
 * - Ctrl+G pauses the questionnaire for a chat about the current question;
 *   the saved snapshot is resumed when the tool is called again
 *
 * Structure: schema.ts (tool params + normalization) / questionnaire-model.ts
 * (domain) / questionnaire-answers.ts (answers, chat-pause capture + restore) /
 * questionnaire-state.ts (pure state machine) / questionnaire-render.ts
 * (pure renderer) / questionnaire-component.ts (TUI wiring). Presentation is
 * intentionally kept basic until the harness visual style is harmonized.
 */

import { Text } from '@earendil-works/pi-tui'

import { runQuestionnaire } from './questionnaire-component.ts'
import { normalizeQuestions } from './questionnaire-model.ts'
import { AskParams } from './schema.ts'

import type {
	AgentToolResult,
	AgentToolUpdateCallback,
} from '@earendil-works/pi-coding-agent'
import type { Theme } from '@earendil-works/pi-coding-agent'
import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type {
	Answer,
	AskResult,
	Question,
	QuestionnaireSnapshot,
} from './questionnaire-model.ts'
import type { AskParamsInput } from './schema.ts'

interface AskToolEnv {
	/** Serializable chat-pause snapshots, keyed by questionnaire content. */
	resumeStates: Map<string, QuestionnaireSnapshot>
	sendFollowUp(message: string): void
}

/** execute() has five parameters; the tool registration turns them into a tuple. */
type AskExecuteArgs = [
	string,
	AskParamsInput,
	AbortSignal | undefined,
	AgentToolUpdateCallback<AskResult> | undefined,
	ExtensionContext,
]

function errorResult(message: string): AgentToolResult<AskResult> {
	return {
		content: [{ type: 'text', text: message }],
		details: { answers: [], cancelled: true },
	}
}

function formatAnswerLine(questionLabel: string, answer: Answer): string {
	if (answer.wasCustom) return `${questionLabel}: user wrote: ${answer.label}`
	if (answer.kind === 'multi' && answer.labels.length > 1) {
		return `${questionLabel}: user selected multiple: ${answer.labels.join(', ')}`
	}
	const prefix =
		answer.kind === 'single' && answer.index ? `${answer.index}. ` : ''
	return `${questionLabel}: user selected: ${prefix}${answer.label}`
}

function formatAnswerLines(
	questions: readonly Question[],
	answers: readonly Answer[],
): string {
	return answers
		.map(answer => {
			const questionLabel =
				questions.find(question => question.id === answer.id)?.label ??
				answer.id
			return formatAnswerLine(questionLabel, answer)
		})
		.join('\n')
}

/** Stable identity of a questionnaire across calls, for snapshot resume. */
function questionnaireKey(questions: readonly Question[]): string {
	return JSON.stringify(
		questions.map(question => ({
			id: question.id,
			label: question.label,
			prompt: question.prompt,
			options: question.options.map(option => ({
				label: option.label,
				description: option.description,
				recommended: option.recommended,
			})),
			allowOther: question.allowOther,
			multiSelect: question.multiSelect,
		})),
	)
}

function chatFollowUp(question: Question): string {
	return [
		`The user wants to chat about the question "${question.label}": ${question.prompt}`,
		'Discuss it with the user. When they are ready to answer, call ask_user_question again with the same questionnaire to resume their saved responses.',
	].join('\n')
}

export default function askUserQuestion(pi: ExtensionAPI): void {
	const resumeStates = new Map<string, QuestionnaireSnapshot>()

	pi.registerTool({
		name: 'ask_user_question',
		label: 'Ask User Question',
		description:
			'Ask the user one or more questions with selectable options. ALWAYS prefer this tool over asking questions in plain text when the choices are discrete: clarifying requirements, choosing between approaches, confirming decisions, or getting preferences. The user can pick options (number keys), select multiple when multiSelect is true, or type a custom answer. Mark the best option with recommended: true when you have a preference. Omit options entirely for open-ended questions where you want a free-form answer.',
		parameters: AskParams,
		executionMode: 'sequential',

		execute: (...execArgs: AskExecuteArgs) => {
			const env: AskToolEnv = {
				resumeStates,
				sendFollowUp: message =>
					pi.sendUserMessage(message, { deliverAs: 'followUp' }),
			}
			return runAskTool(env, execArgs)
		},

		renderCall: (args, theme) => renderAskCall(args, theme),
		renderResult: (toolResult, _options, theme) =>
			renderAskResult(toolResult, theme),
	})
}

async function runAskTool(
	env: AskToolEnv,
	execArgs: AskExecuteArgs,
): Promise<AgentToolResult<AskResult>> {
	const [, params, , , ctx] = execArgs
	if (ctx.mode !== 'tui') {
		return errorResult(
			'Error: UI not available (running in non-interactive mode)',
		)
	}
	if (!params.questions.length) {
		return errorResult('Error: No questions provided')
	}

	const questions: Question[] = normalizeQuestions(params.questions)
	const key = questionnaireKey(questions)
	const outcome = await runQuestionnaire(
		factory => ctx.ui.custom(factory),
		questions,
		env.resumeStates.get(key),
	)

	if (outcome.chat) {
		env.resumeStates.set(key, outcome.chat.snapshot)
		env.sendFollowUp(chatFollowUp(outcome.chat.question))
		return chatPausedResult(outcome)
	}

	env.resumeStates.delete(key)
	if (outcome.cancelled) {
		return {
			content: [{ type: 'text', text: 'User cancelled the question' }],
			details: outcome,
		}
	}
	return {
		content: [
			{
				type: 'text',
				text: formatAnswerLines(questions, outcome.answers),
			},
		],
		details: outcome,
	}
}

function chatPausedResult(outcome: AskResult): AgentToolResult<AskResult> {
	return {
		content: [{ type: 'text', text: 'Chat paused' }],
		details: outcome,
		terminate: true,
	}
}

function renderAskCall(args: unknown, theme: Theme): Text {
	const receivedQuestions = questionLabels(args)
	const labels = receivedQuestions
		.map(question => question.label ?? question.id)
		.join(', ')
	let text = theme.fg('toolTitle', theme.bold('ask_user_question '))
	text += theme.fg(
		'muted',
		`${receivedQuestions.length} question${receivedQuestions.length === 1 ? '' : 's'}`,
	)
	if (labels) {
		text += theme.fg('dim', ` (${labels})`)
	}
	return new Text(text, 0, 0)
}

// Boundary guards for renderCall/renderResult args: the hooks run on the raw,
// unvalidated tool payload, which the schema layer never validates here.
// oxlint-disable-next-line nextnode/no-generic-runtime-guard - canonical low-level boundary guard
function isRecord(input: unknown): input is Record<string, unknown> {
	return typeof input === 'object' && input !== null
}

/** Narrow surface actually read from the raw call args (renderCall runs on
 * unvalidated input - verify, don't force). Invalid entries are skipped. */
function questionLabels(args: unknown): { id: string; label?: string }[] {
	if (
		!isRecord(args) ||
		!('questions' in args) ||
		!Array.isArray(args.questions)
	)
		return []
	return args.questions.filter(isQuestionStub)
}

function isQuestionStub(
	input: unknown,
): input is { id: string; label?: string } {
	return isRecord(input) && typeof input.id === 'string'
}

/** The details payload is raw at runtime (render hooks run on unvalidated
 * calls): the helper takes loose typing so the AskResult guard stays honest. */
function renderAskResult(
	toolResult: AgentToolResult<unknown>,
	theme: Theme,
): Text {
	const { details } = toolResult
	if (isAskResult(details)) {
		return new Text(resultLines(details, theme).join('\n'), 0, 0)
	}
	return new Text(firstTextContent(toolResult), 0, 0)
}

function resultLines(details: AskResult, theme: Theme): string[] {
	if (details.cancelled) return [theme.fg('warning', 'Cancelled')]
	if (details.chat) return [theme.fg('muted', 'Chat paused')]
	return details.answers.map(answer => answerResultLine(answer, theme))
}

function answerResultLine(answer: Answer, theme: Theme): string {
	const check = theme.fg('success', '✓ ')
	const id = theme.fg('accent', answer.id)
	if (answer.wasCustom) {
		return `${check}${id}: ${theme.fg('muted', '(wrote) ')}${answer.label}`
	}
	return `${check}${id}: ${answerDisplay(answer)}`
}

function answerDisplay(answer: Answer): string {
	if (answer.kind === 'multi' && answer.labels.length > 1)
		return answer.labels.join(', ')
	if (answer.kind === 'single' && answer.index)
		return `${answer.index}. ${answer.label}`
	return answer.label
}

function firstTextContent(toolResult: AgentToolResult<unknown>): string {
	const [content] = toolResult.content
	return content?.type === 'text' ? content.text : ''
}

function isAskResult(details: unknown): details is AskResult {
	return (
		isRecord(details) &&
		typeof details.cancelled === 'boolean' &&
		Array.isArray(details.answers) &&
		details.answers.every(isAnswerStub)
	)
}

/** Loose structural check for UI rendering of untrusted details. */
function isAnswerStub(input: unknown): boolean {
	return isRecord(input) && typeof input.id === 'string'
}
