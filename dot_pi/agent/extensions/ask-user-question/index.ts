/** Ask-user-question integration: tool registration and chat-pause lifetime.
 * Domain state/input live in questionnaire-*.ts; shared visual policy lives
 * in ui/. Pending and answered slots share one row-local completion flag. */
import { Text } from '@earendil-works/pi-tui'

import { runQuestionnaire } from './questionnaire-component.ts'
import { normalizeQuestions } from './questionnaire-normalization.ts'
import {
	chatFollowUp,
	formatAnswerLines,
	questionnaireKey,
} from './questionnaire-output.ts'
import {
	renderCallLines,
	renderResultLines,
} from './questionnaire-transcript.ts'
import { AskParams } from './schema.ts'

import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'
import type { Static } from 'typebox'
import type {
	AskResult,
	QuestionnaireInitialState,
} from './questionnaire-model.ts'

interface AskSession {
	resumeStates: Map<string, QuestionnaireInitialState>
	sendFollowUp(message: string): void
}

interface AskRowState {
	answered?: boolean
}

const TOOL_DESCRIPTION =
	'Ask the user one or more questions with selectable options in interactive TUI mode. ALWAYS prefer this tool over questions in plain text; if TUI is unavailable, stop and report that clarification requires it. Group related questions in one call. The user can pick options (number keys), select multiple when multiSelect is true, or type a custom answer. Mark the best option with recommended: true when you have a preference. Omit options entirely for open-ended questions and do not suggest answers. If the user cancels, choose the most reasonable default and report that choice.'

/** No cached output: each render uses the current viewport and row state. */
class TranscriptComponent implements Component {
	constructor(private readonly build: (width: number) => string[]) {}
	invalidate(): void {
		// Pi requires this hook even for stateless renderers.
		return
	}
	render(width: number): string[] {
		return this.build(width)
	}
}

export default function askUserQuestion(pi: ExtensionAPI): void {
	const session: AskSession = {
		resumeStates: new Map(),
		sendFollowUp: message =>
			pi.sendUserMessage(message, { deliverAs: 'followUp' }),
	}
	pi.on('session_shutdown', () => session.resumeStates.clear())
	pi.registerTool<typeof AskParams, AskResult | undefined, AskRowState>({
		name: 'ask_user_question',
		label: 'Ask User Question',
		description: TOOL_DESCRIPTION,
		parameters: AskParams,
		executionMode: 'sequential',
		renderShell: 'self',
		// Destructure Pi's callback boundary; no parallel handwritten signature.
		execute: (...[, params, , , context]) =>
			runAskTool(session, params, context),
		renderCall(args, _theme, context) {
			return new TranscriptComponent(width =>
				context.state.answered ? [] : renderCallLines(args, width),
			)
		},
		renderResult(toolResult, _options, _theme, context) {
			if (!context.state.answered) {
				// oxlint-disable-next-line eslint/no-param-reassign - Pi owns this mutable cross-slot state channel
				context.state.answered = true
				// Do not reenter Pi's in-flight display update synchronously.
				queueMicrotask(() => context.invalidate())
			}
			const { details } = toolResult
			if (details)
				return new TranscriptComponent(width =>
					renderResultLines(details, width),
				)
			const text = toolResult.content
				.flatMap(part => (part.type === 'text' ? [part.text] : []))
				.join('\n')
			return new Text(text, 0, 0)
		},
	})
}

async function runAskTool(
	session: AskSession,
	params: Static<typeof AskParams>,
	context: ExtensionContext,
): Promise<AgentToolResult<AskResult>> {
	if (context.mode !== 'tui')
		throw new Error('ask_user_question requires interactive TUI mode')
	const questions = normalizeQuestions(params.questions)
	const key = questionnaireKey(questions)
	const outcome = await runQuestionnaire(
		factory => context.ui.custom(factory),
		questions,
		session.resumeStates.get(key),
	)
	if (outcome.chat) {
		session.resumeStates.set(key, outcome.chat.initialState)
		session.sendFollowUp(chatFollowUp(outcome.chat.question))
		return {
			content: [{ type: 'text', text: 'Chat paused' }],
			details: outcome,
			terminate: true,
		}
	}
	session.resumeStates.delete(key)
	return {
		content: [
			{
				type: 'text',
				text: outcome.cancelled
					? 'User cancelled the question'
					: formatAnswerLines(questions, outcome.answers),
			},
		],
		details: outcome,
	}
}
