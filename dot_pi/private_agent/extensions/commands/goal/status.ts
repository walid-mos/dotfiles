/** The checklist lives above the editor independently of network availability. */
import { activeGoal } from '#lib/goal/state.ts'
import { isHumanPrompt } from '#lib/human-prompt.ts'
import {
	ABOVE_EDITOR_PRIORITY,
	setOrderedAboveEditorWidget,
} from '#lib/ui/ordered-widget-stack.ts'

import { toggleGoalPanel } from './panel.ts'
import { goalVisibility } from './visibility.ts'
import { renderGoalWidget } from './widget.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { TuiMouseEvent } from '@earendil-works/pi-tui'
import type { GoalState } from '#lib/goal/state.ts'
import type { OrderedWidgetEntry } from '#lib/ui/ordered-widget-stack.ts'
import type { GoalWidgetVisibility } from './panel.ts'

const WIDGET_ID = 'goal-progress'
const visibility = goalVisibility()
let isCompletedDismissed = false

export function isGoalWidgetVisible(): boolean {
	return visibility.isVisible()
}

/** Widget visibility controls the screen and the `/goal-widget` command share. */
export function goalWidgetVisibility(
	ctx: ExtensionContext,
): GoalWidgetVisibility {
	return {
		isVisible: () => visibility.isVisible(),
		setVisible: isVisible => setGoalWidgetVisible(ctx, isVisible),
	}
}

/** A left click anywhere on the widget toggles the same checklist as `/goal`. */
function widgetMouse(ctx: ExtensionContext) {
	return (event: TuiMouseEvent): boolean => {
		if (event.type !== 'click' || event.button !== 'left') return false
		void (async () => {
			try {
				await toggleGoalPanel(ctx, goalWidgetVisibility(ctx))
			} catch (cause) {
				ctx.ui.notify(
					cause instanceof Error ? cause.message : String(cause),
					'error',
				)
			}
		})()
		return true
	}
}

function goalWidgetEntry(
	ctx: ExtensionContext,
	state: GoalState,
): OrderedWidgetEntry {
	return {
		priority: ABOVE_EDITOR_PRIORITY.goal,
		render: width => renderGoalWidget(state, width),
		mouse: widgetMouse(ctx),
	}
}

export function showGoalStatus(
	ctx: ExtensionContext,
	state: GoalState | undefined,
): void {
	ctx.ui.setStatus('goal', undefined)
	if (state?.items.some(goalItem => !goalItem.done))
		isCompletedDismissed = false
	if (ctx.mode !== 'tui') return
	setOrderedAboveEditorWidget(
		ctx.ui,
		WIDGET_ID,
		visibility.isVisible() && !isCompletedDismissed && state?.items.length
			? goalWidgetEntry(ctx, state)
			: undefined,
	)
}

export function setGoalWidgetVisible(
	ctx: ExtensionContext,
	isVisible: boolean,
): void {
	visibility.setVisible(isVisible)
	if (isVisible) isCompletedDismissed = false
	showGoalStatus(ctx, activeGoal(ctx.sessionManager.getBranch()))
}

export function registerGoalStatus(pi: ExtensionAPI): void {
	pi.on('session_start', (_event, ctx) => {
		isCompletedDismissed = false
		showGoalStatus(ctx, activeGoal(ctx.sessionManager.getBranch()))
	})
	pi.on('session_tree', (_event, ctx) => {
		isCompletedDismissed = false
		showGoalStatus(ctx, activeGoal(ctx.sessionManager.getBranch()))
	})
	pi.on('input', (event, ctx) => {
		if (!isHumanPrompt(event)) return
		const state = activeGoal(ctx.sessionManager.getBranch())
		if (!state || state.items.some(goalItem => !goalItem.done)) return
		isCompletedDismissed = true
		showGoalStatus(ctx, state)
	})
	pi.on('session_shutdown', (_event, ctx) => {
		isCompletedDismissed = false
		showGoalStatus(ctx, undefined)
	})
}
