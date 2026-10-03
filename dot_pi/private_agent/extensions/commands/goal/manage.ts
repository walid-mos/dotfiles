/**
 * User-requested goal re-evaluation: delete and revise.
 *
 * route-events.ts records genuine human input with its goal revision. That
 * record alone grants no permission: one Jev coverage check must confirm that
 * the human explicitly requested this change. A revision bump consumes it.
 * Ordinary completion records never need this remote, destructive-edit gate.
 */
import { activeGoal, GOAL_STATE_ENTRY, manageMarker } from '#lib/goal/state.ts'
import { askChoice, isJevConfigured } from '#lib/jev/client.ts'

import { deleteGoal, revisePlan } from './manage-edits.ts'
import { showGoalStatus } from './status.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { GoalManageMarker, GoalState } from '#lib/goal/state.ts'
import type { ChoiceQuestion } from '#lib/jev/client.ts'
import type { GoalParameters } from './schema.ts'

/** Destructive goal edits require a high-confidence coverage verdict. */
const MIN_CONFIDENCE = 0.8

function assertMarker(
	current: GoalState,
	ctx: ExtensionContext,
): GoalManageMarker {
	const marker = manageMarker(ctx.sessionManager.getBranch())
	if (!marker)
		throw new Error(
			'goal delete/revise requires recorded human input and an explicit re-evaluation request. Ask the human to state it; never restructure a goal to fit ongoing work.',
		)
	if (marker.truncated)
		throw new Error(
			'The human request was truncated; delete/revise needs a concise explicit request. Nothing was changed.',
		)
	if (marker.revision !== current.revision)
		throw new Error(
			`The routed re-evaluation request applies to revision ${marker.revision}; the goal is at revision ${current.revision}. The goal changed since the human asked; a further delete/revise needs a new explicit request.`,
		)
	return marker
}

type ManageProps = {
	action: 'delete' | 'revise'
	items?: string[] | undefined
	reason?: string | undefined
}

function describeChange(props: ManageProps): object {
	if (props.action === 'delete')
		return {
			action: 'delete',
			effect: 'clear the whole active checklist, including completed history',
			reason: props.reason,
		}
	return {
		action: 'revise',
		effect: 'replace the remaining plan items with the listed ones; unlisted completed work is preserved',
		items: props.items,
		reason: props.reason,
	}
}

const CLAIM_QUESTION: ChoiceQuestion = {
	instructions:
		'Judge whether state.proposedChange is exactly the goal re-evaluation the human requested in state.humanRequest, relative to state.activeGoal. delete must mean clearing the whole checklist; revise replaces the remaining plan items with its list. Items the request does not mention may change only when the requested outcome clearly covers them ("clear everything", "start over", "shrink the plan"). Decline when the request does not clearly cover this specific change.',
	criteria: {
		covered:
			'The proposed change performs exactly the requested re-evaluation; every removed, rewritten or added item is covered by the human request.',
		differs:
			'The proposed change removes, adds or rewrites items beyond what the human request covers, or does not clearly match it.',
	},
}

async function verifyClaim(input: {
	marker: GoalManageMarker
	current: GoalState
	props: ManageProps
	signal: AbortSignal | undefined
}): Promise<void> {
	const { marker, current, props, signal } = input
	if (!isJevConfigured())
		throw new Error(
			'Goal re-evaluation needs TYPESAFE_API_KEY; nothing was changed.',
		)
	const verdict = await askChoice(
		{
			activeGoal: {
				revision: current.revision,
				request: current.request,
				items: current.items.map(({ id, text, done, kind }) => ({
					id,
					text,
					done,
					kind,
				})),
			},
			humanRequest: marker.prompt,
			proposedChange: describeChange(props),
		},
		CLAIM_QUESTION,
		{ signal },
	)
	if (signal?.aborted)
		throw new Error(
			'The re-evaluation check was cancelled; nothing was changed.',
		)
	if (verdict.choice !== 'covered' || verdict.confidence < MIN_CONFIDENCE)
		throw new Error(
			`goal ${props.action} refused: the change is not covered by the routed human request (${verdict.choice} at ${verdict.confidence}). Match the request exactly, or ask the human for a clearer one.`,
		)
}

export type ManageOutcome = {
	next: GoalState | undefined
	report: string
}

/** Prompt excerpt carried into the applied record, bounded for tool output. */
const REPORT_PROMPT_CHARS = 120

function applyChange(input: {
	action: 'delete' | 'revise'
	current: GoalState
	ctx: ExtensionContext
	items: string[] | undefined
}): GoalState {
	const { action, current, ctx, items } = input
	const latest = activeGoal(ctx.sessionManager.getBranch())
	if (latest?.revision !== current.revision)
		throw new Error(
			`The goal changed during the check (now revision ${latest?.revision ?? 'none'}); the routed authorisation no longer applies; ask the human.`,
		)
	const next =
		action === 'delete'
			? deleteGoal(latest)
			: revisePlan(latest, items ?? [])
	return next
}

export async function executeManage(input: {
	pi: ExtensionAPI
	ctx: ExtensionContext
	current: GoalState | undefined
	params: GoalParameters
	signal: AbortSignal | undefined
}): Promise<ManageOutcome> {
	const { pi, ctx, current, params, signal } = input
	if (params.action !== 'delete' && params.action !== 'revise')
		throw new Error(
			`goal ${params.action} does not belong to the re-evaluation flow.`,
		)
	const { action } = params
	if (!current) throw new Error(`goal ${action} needs an active goal.`)
	const marker = assertMarker(current, ctx)
	const sessionId = ctx.sessionManager.getSessionId()
	await verifyClaim({
		marker,
		current,
		props: {
			action,
			items: params.items,
			reason: params.reason,
		},
		signal,
	})
	if (sessionId !== ctx.sessionManager.getSessionId())
		throw new Error(
			'Session switched during the re-evaluation check; retry in the original session.',
		)
	const next = applyChange({
		action,
		current,
		ctx,
		items: params.items,
	})
	pi.appendEntry(GOAL_STATE_ENTRY, next)
	showGoalStatus(ctx, next)
	return {
		next,
		report: `\nRe-evaluation ${action} applied; the routed authorisation is used ("${marker.prompt.slice(0, REPORT_PROMPT_CHARS)}").`,
	}
}
