/** The running agent interprets human intent; no separate model call routes work. */
import { goalText } from '#lib/goal/state.ts'

import type { GoalState } from '#lib/goal/state.ts'

/** Reporting policy shared by the tool and human-input notice; never blocks work. */
export const GOAL_PROGRESS_RULE =
	'Tick each task as soon as its result is verified, before starting other work. Batch ticks only when the same completed tool batch verifies several tasks.'

export function workInstruction(state: GoalState | undefined): string {
	return [
		'For action requests, track concrete tasks with goal. For questions or discussion, leave goals untouched. Goal records are local and do not authorize destructive actions or external writes.',
		state
			? goalText(state)
			: 'No checklist is open. Use goal action=declare before work.',
		'Continue related work with the existing item IDs. For an unrelated human request, use action=start to save the current checklist as paused and declare the new tasks. Use action=resume to unblock related work.',
		GOAL_PROGRESS_RULE,
		'Outcomes record observed results and their check source or method; they are self-reported evidence, not an independent factual check. Audit the whole request and tick its request item last.',
		'Delete/revise still require an explicit recorded human request and a coverage check; they are not completion actions.',
	].join('\n')
}
