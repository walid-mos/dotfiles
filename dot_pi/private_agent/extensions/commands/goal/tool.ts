import {
	activeGoal,
	GOAL_STATE_ENTRY,
	goalText,
	manageMarker,
} from '#lib/goal/state.ts'

import { applyAcceptedTicks } from './commit-ticks.ts'
import { changeGoal, prepareTicks } from './edits.ts'
import { executeManage } from './manage.ts'
import { GOAL_PROGRESS_RULE } from './routing.ts'
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
	return goalResult(applied.next ?? latest, report)
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
	return goalResult(next ?? current)
}

export function registerGoalTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: 'goal',
		label: 'Goal',
		description: `Maintain the active branch checklist locally. Record completed tasks with action=tick and ticks=[{id,outcome}], including the observed result and check source or method; outcomes are self-reported evidence, not independent verification. ${GOAL_PROGRESS_RULE} Declare once; add only newly discovered work with a reason. Use start only for an unrelated new human request: it saves the current checklist as paused. Resume unblocks related work. Delete/revise require recorded human input at the unchanged goal revision and a Jev check confirming that the human explicitly requested the proposed change. A failed authorization check never disables local tracking. Goal completion does not authorize destructive actions or external writes. Only human input starts a turn. Action call examples:\n${GOAL_ACTION_USAGE}`,
		promptSnippet:
			'Record verified task results locally; delete/revise only on an explicit human request',
		promptGuidelines: [
			`When a goal is open, declare concrete tasks once. ${GOAL_PROGRESS_RULE} Include the observed result and check location or method in each outcome. Local validation keeps request completion after concrete tasks. Re-evaluations (delete/revise) require an explicit recorded human request and a coverage check, never a plan changed to fit ongoing work. Audit the whole request and include its item last.`,
		],
		parameters: goalParameters,
		executionMode: 'sequential',
		// Pi supplies five arguments to tool execute.
		// oxlint-disable-next-line eslint/max-params
		execute: async (_toolCallId, params, signal, _onUpdate, ctx) =>
			executeGoal({ pi, params, signal, ctx }),
	})
}
