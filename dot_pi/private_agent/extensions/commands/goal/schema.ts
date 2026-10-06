/** Model-facing arguments and action contracts. Keep the root object provider-compatible. */
import { StringEnum } from '@earendil-works/pi-ai'
import { Type } from 'typebox'

import { MAX_GOAL_ITEMS } from '#lib/goal/state.ts'

import type { Static } from 'typebox'

const actionArguments = {
	start: { items: ['Complete the unrelated new human request.'] },
	resume: {},
	declare: { items: ['Verify the installed version and running service.'] },
	add: {
		items: ['Verify the newly discovered affected service.'],
		reason: 'Inspection found another service using the same configuration.',
	},
	tick: {
		ticks: [
			{
				id: 2,
				outcome: 'Checked app --version: 0.9.3; app status: running.',
			},
			{
				id: 3,
				outcome:
					'curl -s localhost:8080/health returned 200 {"ok":true}.',
			},
		],
	},
	block: { reason: 'The required account access needs a human decision.' },
	delete: {
		reason: 'The human explicitly asked to delete the goal: quote their request here.',
	},
	revise: {
		items: [
			'Verify the two conformant cases; drop the three stale demo cases.',
		],
		reason: 'The human explicitly asked to update the plan: quote their request here.',
	},
	status: {},
	activate: { id: 1 },
} as const

type GoalAction = keyof typeof actionArguments
const actions = Object.keys(actionArguments).filter(
	(action): action is GoalAction => Object.hasOwn(actionArguments, action),
)

function example(action: GoalAction): string {
	return JSON.stringify({ action, ...actionArguments[action] })
}

export const GOAL_ACTION_USAGE = actions.map(example).join('\n')

/** Length and line breaks are normalized on receipt (boundedGoalText), never rejected. */
const text = Type.String({ minLength: 1 })
const batch = { minItems: 1, maxItems: MAX_GOAL_ITEMS }

export const goalParameters = Type.Object(
	{
		action: StringEnum(actions, {
			description:
				'Choose an action and supply only its fields, as shown in the tool examples.',
		}),
		ticks: Type.Optional(
			Type.Array(
				Type.Object(
					{
						id: Type.Integer({
							minimum: 1,
							description:
								'Existing checklist item ID from goal status.',
						}),
						outcome: Type.String({
							...text,
							description:
								'Observed result and check source or method, not just DONE.',
						}),
					},
					{ additionalProperties: false },
				),
				{
					...batch,
					description:
						'Required for tick only. One {id, outcome} object per task, never numbered or extra keys; accepted ticks persist.',
				},
			),
		),
		items: Type.Optional(
			Type.Array(text, {
				...batch,
				description:
					'Required for declare, start, add and revise only: the new plan texts. For revise, list every item the remaining plan should hold; listed texts keep their existing item. To complete existing tasks, use ticks instead.',
			}),
		),
		reason: Type.Optional(
			Type.String({
				...text,
				description:
					'Required for block, add, delete and revise only: the human decision needed, the newly-discovered work reason, or the exact request to re-evaluate the goal.',
			}),
		),
		id: Type.Optional(
			Type.Integer({
				minimum: 1,
				description:
					'Required for activate only: paused goal number from status, not a checklist item ID.',
			}),
		),
	},
	{ additionalProperties: false },
)

export type GoalParameters = Static<typeof goalParameters>

/** Enforce action-specific fields without a root union that some providers reject. */
export function assertGoalArguments(params: GoalParameters): void {
	const required = Object.keys(actionArguments[params.action])
	const supplied = Object.keys(params).filter(key => key !== 'action')
	const missing = required.filter(key => !Reflect.has(params, key))
	const unexpected = supplied.filter(key => !required.includes(key))
	if (!missing.length && !unexpected.length) return
	throw new Error(
		`goal ${params.action}: ${[
			...(missing.length ? [`missing ${missing.join(', ')}`] : []),
			...(unexpected.length
				? [`unexpected ${unexpected.join(', ')}`]
				: []),
		].join(
			'; ',
		)}. Expected: ${example(params.action)} Use real IDs and evidence from this goal.`,
	)
}
