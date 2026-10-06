import {
	activeGoal,
	GOAL_STATE_ENTRY,
	goalDeltaText,
	goalText,
	manageMarker,
} from '#lib/goal/state.ts'

import { applyAcceptedTicks } from './commit-ticks.ts'
import { changeGoal, prepareTicks } from './edits.ts'
import { executeManage } from './manage.ts'
import {
	assertGoalArguments,
	GOAL_ACTION_USAGE,
	goalParameters,
} from './schema.ts'
import { showGoalStatus } from './status.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { GoalState } from '#lib/goal/state.ts'
import type { GoalParameters } from './schema.ts'

type GoalResult = {
	content: { type: 'text'; text: string }[]
	details: { revision: number | undefined }
}

function goalResult(state: GoalState | undefined, feedback = ''): GoalResult {
	return {
		content: [
			{
				type: 'text',
				text: `${state ? goalText(state) : 'No active goal. Declare tasks first.'}${feedback}`,
			},
		],
		details: { revision: state?.revision },
	}
}

/** Ticks and declarations answer with what changed, not the whole checklist. */
function goalDeltaResult(
	previous: GoalState | undefined,
	next: GoalState | undefined,
	feedback = '',
): GoalResult {
	if (!next) return goalResult(previous, feedback)
	return {
		content: [
			{
				type: 'text',
				text: `${goalDeltaText(previous, next)}${feedback}`,
			},
		],
		details: { revision: next.revision },
	}
}

function executeTicks(input: {
	pi: ExtensionAPI
	ctx: ExtensionContext
	current: GoalState | undefined
	ticks: { id: number; outcome: string }[] | undefined
}): GoalResult {
	const { pi, ctx, current, ticks } = input
	const pending = prepareTicks(current, ticks)
	if (!current || !pending.length) return goalResult(current)
	const latest = activeGoal(ctx.sessionManager.getBranch())
	const applied = applyAcceptedTicks(current, latest, pending)
	if (applied.next) {
		pi.appendEntry(GOAL_STATE_ENTRY, applied.next)
		showGoalStatus(ctx, applied.next)
	}
	const report = [
		`\nSaved now: ${applied.applied.map(id => `#${id}`).join(', ') || 'none'}.`,
		...(applied.alreadyDone.length
			? [
					`Already done: ${applied.alreadyDone.map(id => `#${id}`).join(', ')}.`,
				]
			: []),
		...(applied.rejected.length
			? [
					`Not saved: ${applied.rejected.map(entry => `#${entry.id} ${entry.reason}`).join('; ')}. Recheck these IDs; do not resubmit saved items.`,
				]
			: []),
	].join('\n')
	return goalDeltaResult(current, applied.next ?? latest, report)
}

function assertAllowedEdit(
	current: GoalState | undefined,
	params: GoalParameters,
): void {
	if (
		params.action === 'declare' &&
		current?.items.some(goalItem => !goalItem.done) &&
		current.items.some(goalItem => goalItem.kind !== 'request')
	)
		throw new Error(
			'This goal already has a plan. Use its existing item IDs; add only newly discovered work with a reason.',
		)
	if (params.action === 'add' && !params.reason?.trim())
		throw new Error(
			'goal add requires a reason naming the newly discovered work.',
		)
}

function declareWork(
	current: GoalState | undefined,
	params: GoalParameters,
	ctx: ExtensionContext,
): GoalState | undefined {
	const marker = manageMarker(ctx.sessionManager.getBranch())
	const isFresh = marker?.revision === (current?.revision ?? 0)
	const needsNew =
		params.action === 'start' ||
		!current?.items.some(goalItem => !goalItem.done)
	if (!needsNew)
		return changeGoal(current, {
			action: 'declare',
			items: params.items ?? [],
		})
	if (!isFresh && current)
		throw new Error(
			'Starting another goal requires new human input; keep the current checklist.',
		)
	if (params.action === 'start' && !isFresh)
		throw new Error(
			'goal start requires a recorded human request; use declare for a first headless checklist.',
		)
	const seeded = isFresh
		? changeGoal(current, { action: 'seed', request: marker.prompt })
		: undefined
	return changeGoal(seeded, { action: 'declare', items: params.items ?? [] })
}

async function executeGoal(input: {
	pi: ExtensionAPI
	params: GoalParameters
	signal: AbortSignal | undefined
	ctx: ExtensionContext
}): Promise<GoalResult> {
	const { pi, params, signal, ctx } = input
	assertGoalArguments(params)
	if (signal?.aborted)
		throw new Error('Goal operation was cancelled; nothing was saved.')
	const current = activeGoal(ctx.sessionManager.getBranch())
	assertAllowedEdit(current, params)
	if (params.action === 'tick')
		return executeTicks({ pi, ctx, current, ticks: params.ticks })
	if (params.action === 'delete' || params.action === 'revise') {
		const outcome = await executeManage({
			pi,
			ctx,
			current,
			params,
			signal,
		})
		return goalResult(outcome.next ?? current, outcome.report)
	}
	const next =
		params.action === 'declare' || params.action === 'start'
			? declareWork(current, params, ctx)
			: changeGoal(current, {
					...params,
					action: params.action === 'add' ? 'declare' : params.action,
				})
	if (next) {
		pi.appendEntry(GOAL_STATE_ENTRY, next)
		showGoalStatus(ctx, next)
	}
	return editResult(params, current, next)
}

/** Adding items to an existing checklist answers with the delta; everything else with the full text. */
function editResult(
	params: GoalParameters,
	current: GoalState | undefined,
	next: GoalState | undefined,
): GoalResult {
	const isIncremental = params.action === 'declare' || params.action === 'add'
	if (isIncremental && current)
		return goalDeltaResult(current, next ?? current)
	return goalResult(next ?? current)
}

/** Reporting policy; its only home is the description the model reads at call time. */
const GOAL_PROGRESS_RULE =
	'Tick a task as soon as its result is verified, in the same assistant message as your next tool call; a message holding only a tick is wasted unless no tool call follows. One tick call carries every task the same completed tool batch verified.'

/** Agent rules in the system prompt Guidelines; the per-request context carries state only. */
const GOAL_GUIDELINES = [
	'Action requests get concrete goal tasks declared once, then worked with their existing item IDs; questions and discussion leave goals untouched.',
	'Outcomes name the observed result and its check source or method; they are self-reported evidence, not independent verification. Audit the whole request and tick its request item last.',
	'Never reshape a plan to fit ongoing work: add discovered work with a reason, and revise or delete only on an explicit request in the latest human prompt.',
	'Goal records never authorize destructive actions or external writes; only human input starts a turn.',
]

export function registerGoalTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: 'goal',
		label: 'Goal',
		description: `Branch-local checklist. tick saves {id, outcome} for verified tasks. declare creates the plan once; add appends newly discovered work with a reason; start opens a goal for an unrelated human request and pauses the current one; block records a needed human decision and resume clears it; activate returns to a paused goal; status prints the full checklist with completed history; delete/revise re-evaluate the plan and need an explicit request in the latest human prompt. ${GOAL_PROGRESS_RULE} Call examples:\n${GOAL_ACTION_USAGE}`,
		promptSnippet:
			'Record verified task results locally; delete/revise only on an explicit human request',
		promptGuidelines: GOAL_GUIDELINES,
		parameters: goalParameters,
		executionMode: 'sequential',
		// Pi supplies five arguments to tool execute.
		// oxlint-disable-next-line eslint/max-params
		execute: async (_toolCallId, params, signal, _onUpdate, ctx) =>
			executeGoal({ pi, params, signal, ctx }),
	})
}
