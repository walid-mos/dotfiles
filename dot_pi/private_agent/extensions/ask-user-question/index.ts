/** Ask-user-question integration: tool registration and chat-pause lifetime.
 * Domain state/input live in questionnaire-*.ts; shared visual policy lives
 * in ui/. Pending and answered slots share one row-local completion flag.
 * Screenshot captures follow the prompt-attachments contract: aliases and a
 * thumbnail strip in the dialog, full images on the submitted tool result,
 * tile-sized snapshot records replayed with the answered card. */
import { Text } from '@earendil-works/pi-tui'

import { QuestionnaireCaptures } from './questionnaire-captures.ts'
import { runQuestionnaire } from './questionnaire-component.ts'
import { QUESTIONNAIRE_MODE_EVENT } from './questionnaire-events.ts'
import {
	normalizeQuestions,
	parseAskResult,
} from './questionnaire-normalization.ts'
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
import type { QuestionnaireMode } from './questionnaire-events.ts'
import type {
	AskResult,
	QuestionnaireInitialState,
} from './questionnaire-model.ts'

interface AskSession {
	resumeStates: Map<string, QuestionnaireInitialState>
	sendFollowUp(message: string): void
	setMode(mode: QuestionnaireMode): void
}

interface AskRowState {
	answered?: boolean
}

const TOOL_DESCRIPTION =
	'Ask only for a consequential decision that the human must make. Do not ask when context, established conventions, best practice, or a low-risk reversible default can decide; choose the default and continue. Before calling, gather every currently known human-only blocker into one questionnaire instead of asking across successive turns. A task should normally have one questionnaire round; ask later only when new evidence creates a new blocker. Use this tool instead of a plain-text question. Every question needs a short, unique, stable id reused as the answer key. The user can always write their own answer, select an option by number, or select multiple options when multiSelect is true. Mark the best option recommended when you have one. Omit options for a genuinely open-ended question. If the user cancels, choose the most reasonable default and report it.'

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
		setMode: mode => pi.events.emit(QUESTIONNAIRE_MODE_EVENT, mode),
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
		renderResult(toolResult, _options, theme, context) {
			if (!context.state.answered) {
				// oxlint-disable-next-line eslint/no-param-reassign - Pi owns this mutable cross-slot state channel
				context.state.answered = true
				// Do not reenter Pi's in-flight display update synchronously.
				queueMicrotask(() => context.invalidate())
			}
			// Replayed details round-trip through the session file and may predate
			// the current schema: parse before rendering, else fall back to text.
			const details = parseAskResult(toolResult.details)
			if (details)
				return new TranscriptComponent(width =>
					renderResultLines(details, width, theme),
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
	session.setMode('answering')
	const key = questionnaireKey(questions)
	const captures = new QuestionnaireCaptures(context.cwd)
	try {
		const resumeState = session.resumeStates.get(key)
		if (resumeState?.captures?.length)
			captures.restore(resumeState.captures)
		const outcome = await runQuestionnaire(
			factory => context.ui.custom(factory),
			questions,
			resumeState,
			captures,
		)
		if (outcome.chat) {
			session.resumeStates.set(key, outcome.chat.initialState)
			session.setMode('discussing')
			session.sendFollowUp(chatFollowUp(outcome.chat.question))
			return {
				content: [{ type: 'text', text: 'Chat paused' }],
				details: outcome,
				terminate: true,
			}
		}
		session.resumeStates.delete(key)
		return completedResult(questions, outcome, captures)
	} finally {
		await captures.dispose()
	}
}

function completedResult(
	questions: ReturnType<typeof normalizeQuestions>,
	outcome: AskResult,
	captures: QuestionnaireCaptures,
): AgentToolResult<AskResult> {
	const resultImages = captures.modelAttachments(
		(outcome.captures ?? []).map(record => record.alias),
	)
	return {
		content: [
			{
				type: 'text',
				text: outcome.cancelled
					? 'User cancelled the question'
					: formatAnswerLines(questions, outcome.answers),
			},
			...resultImages,
		],
		details: outcome,
	}
}
