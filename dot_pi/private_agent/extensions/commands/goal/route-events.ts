/** Record genuine human input locally; interpreting it stays with the running agent. */
import {
	activeGoal,
	GOAL_CHANGE_AUTHORIZATION_ENTRY,
	MAX_GOAL_TEXT,
} from '#lib/goal/state.ts'
import { isHumanPrompt } from '#lib/human-prompt.ts'
import { runTimedHook } from '#lib/telemetry/hook-timing.ts'

import { workInstruction } from './routing.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

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
			const current = activeGoal(ctx.sessionManager.getBranch())
			if (prompt) {
				// This is a candidate request, not permission: manage.ts verifies coverage.
				const normalized = prompt.replace(/\s+/g, ' ').trim()
				pi.appendEntry(GOAL_CHANGE_AUTHORIZATION_ENTRY, {
					revision: current?.revision ?? 0,
					prompt: normalized.slice(0, MAX_GOAL_TEXT),
					truncated: normalized.length > MAX_GOAL_TEXT,
				})
			}
			return {
				message: {
					customType: 'goal-route',
					display: false,
					content: workInstruction(current),
				},
			}
		}),
	)
}
