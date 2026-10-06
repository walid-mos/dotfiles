/**
 * Record genuine human input locally and show the live checklist per request.
 * Interpreting the input stays with the running agent; the checklist travels
 * through the `context` event, never as a persisted message, so no request
 * carries the history of earlier checklists.
 */
import {
	activeGoal,
	GOAL_CHANGE_AUTHORIZATION_ENTRY,
	goalContextText,
	MAX_GOAL_TEXT,
} from '#lib/goal/state.ts'
import { isHumanPrompt, typedPromptText } from '#lib/human-prompt.ts'
import { runTimedHook } from '#lib/telemetry/hook-timing.ts'

import type {
	ContextEvent,
	ExtensionAPI,
} from '@earendil-works/pi-coding-agent'
import type { GoalState } from '#lib/goal/state.ts'

const GOAL_CONTEXT_TYPE = 'goal-context'

type ContextMessage = ContextEvent['messages'][number]

function goalContextMessage(state: GoalState): ContextMessage {
	return {
		role: 'custom',
		customType: GOAL_CONTEXT_TYPE,
		content: goalContextText(state),
		display: false,
		timestamp: Date.now(),
	}
}

export function registerGoalRouting(pi: ExtensionAPI): void {
	let pendingPrompt: string | undefined
	const clear = (): void => {
		pendingPrompt = undefined
	}
	pi.on('session_start', clear)
	pi.on('session_tree', clear)
	pi.on('session_shutdown', clear)
	pi.on('input', event => {
		if (isHumanPrompt(event)) pendingPrompt = event.text
	})
	pi.on('before_agent_start', (_event, ctx) =>
		runTimedHook('before_agent_start', 'goal.route', () => {
			const prompt = pendingPrompt
			pendingPrompt = undefined
			if (!prompt) return
			// A candidate request, not permission: manage.ts verifies coverage.
			const normalized = typedPromptText(prompt)
				.replace(/\s+/g, ' ')
				.trim()
			pi.appendEntry(GOAL_CHANGE_AUTHORIZATION_ENTRY, {
				revision:
					activeGoal(ctx.sessionManager.getBranch())?.revision ?? 0,
				prompt: normalized.slice(0, MAX_GOAL_TEXT),
				truncated: normalized.length > MAX_GOAL_TEXT,
			})
		}),
	)
	pi.on('context', (event, ctx) => {
		const current = activeGoal(ctx.sessionManager.getBranch())
		if (!current?.items.length) return undefined
		return { messages: [...event.messages, goalContextMessage(current)] }
	})
}
