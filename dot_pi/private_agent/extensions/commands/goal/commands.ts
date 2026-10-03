import { activeGoal, GOAL_STATE_ENTRY, goalText } from '#lib/goal/state.ts'

import { changeGoal } from './edits.ts'
import { deleteGoal } from './manage-edits.ts'
import { toggleGoalPanel } from './panel.ts'
import {
	goalWidgetVisibility,
	isGoalWidgetVisible,
	setGoalWidgetVisible,
	showGoalStatus,
} from './status.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

function registerGoalWidgetCommand(pi: ExtensionAPI): void {
	pi.registerCommand('goal-widget', {
		description:
			'Toggle the compact goal widget (hide/show; saved across sessions)',
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase()
			if (action && action !== 'show' && action !== 'hide') {
				ctx.ui.notify('Use /goal-widget [show|hide].', 'warning')
				return
			}
			const isVisible =
				action === 'show' || (!action && !isGoalWidgetVisible())
			setGoalWidgetVisible(ctx, isVisible)
			ctx.ui.notify(
				`Goal widget ${isVisible ? 'shown' : 'hidden'}. ${isVisible ? '/goal opens the checklist.' : '/goal-widget show restores it.'}`,
				'info',
			)
		},
	})
}

function registerGoalCommand(pi: ExtensionAPI): void {
	pi.registerCommand('goal', {
		description:
			'Open the goal checklist, or declare semicolon-separated tasks',
		handler: async (args, ctx) => {
			const current = activeGoal(ctx.sessionManager.getBranch())
			if (!args.trim()) {
				if (
					ctx.mode === 'tui' &&
					current &&
					(current.items.length || current.paused?.length)
				)
					await toggleGoalPanel(ctx, goalWidgetVisibility(ctx))
				else
					ctx.ui.notify(
						current ? goalText(current) : 'No active goal.',
						'info',
					)
				return
			}
			const next = changeGoal(current, {
				action: 'declare',
				items: args.split(';'),
			})
			if (next) {
				pi.appendEntry(GOAL_STATE_ENTRY, next)
				showGoalStatus(ctx, next)
			}
			const status = next ?? current
			if (status) ctx.ui.notify(goalText(status), 'info')
		},
	})
}

export function registerGoalCommands(pi: ExtensionAPI): void {
	registerGoalCommand(pi)
	registerGoalWidgetCommand(pi)
	pi.registerCommand('goal-clear', {
		description: 'Clear the checklist on this branch',
		handler: async (_args, ctx) => {
			const current = activeGoal(ctx.sessionManager.getBranch())
			if (!current?.items.length) return
			const next = deleteGoal(current)
			pi.appendEntry(GOAL_STATE_ENTRY, next)
			showGoalStatus(ctx, undefined)
			ctx.ui.notify('Goal cleared on this branch.', 'info')
		},
	})
}
