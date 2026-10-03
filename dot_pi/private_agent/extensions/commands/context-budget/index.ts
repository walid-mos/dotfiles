/**
 * Context Budget owns growth and summaries. The live picker saves its limit
 * without waiting for model work. Pi stores checkpoints; native auto-compaction stays off.
 * The hud-footer context gauge renders the saved limit as its share of the
 * model window; this extension announces saves on the shared bus instead of
 * printing a plain-text footer status.
 */
import { writeCheckpointBudget } from '#lib/context-budget/budget-writer.ts'
import { BUDGET_SAVED_EVENT } from '#lib/context-budget/events.ts'
import {
	checkpointWindowCap,
	minimumCheckpointCeiling,
	readCheckpointSettings,
} from '#lib/context-budget/model.ts'

import { ceilingLabel, parseCeiling } from './choices.ts'
import { contextCeiling, registerContextGrowth } from './growth.ts'
import { LimitPicker } from './limit-picker.ts'
import { summarize } from './summary.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'

function limitText(ctx: ExtensionContext): string {
	const configured = readCheckpointSettings().maxContextTokens
	const effective = Math.min(
		configured,
		checkpointWindowCap(ctx.model?.contextWindow),
	)
	return `${ceilingLabel(configured)} configured · ${ceilingLabel(effective)} in use`
}

function usageText(ctx: ExtensionContext): string {
	const tokens = ctx.getContextUsage()?.tokens
	const used = typeof tokens === 'number' ? ceilingLabel(tokens) : 'unknown'
	return `Context ${used}; limit ${ceilingLabel(contextCeiling(ctx))}`
}

/** One repaint for every listener: the settings file changed underneath. */
function announceBudgetSaved(pi: ExtensionAPI): void {
	if (!pi.events || typeof pi.events.emit !== 'function') return
	pi.events.emit(BUDGET_SAVED_EVENT, undefined)
}

async function saveCeiling(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	tokens: number,
): Promise<void> {
	await writeCheckpointBudget(tokens)
	announceBudgetSaved(pi)
	ctx.ui.notify(
		`Context Budget saved: ${limitText(ctx)}. Applies at the next completed tool batch.`,
		'info',
	)
}

async function openLimitPicker(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
): Promise<void> {
	const settings = readCheckpointSettings()
	const picked = await ctx.ui.custom<number | undefined>(
		(tui, _theme, _keybindings, done) =>
			new LimitPicker({
				configuredTokens: settings.maxContextTokens,
				minimumTokens: minimumCheckpointCeiling(
					settings.keepRecentTokens,
				),
				modelCapTokens: checkpointWindowCap(ctx.model?.contextWindow),
				height: () => tui.terminal.rows,
				repaint: () => tui.requestRender(),
				done,
			}),
		{ overlay: true },
	)
	if (typeof picked === 'number') await saveCeiling(pi, ctx, picked)
}

async function handleCommand(
	argument: string,
	pi: ExtensionAPI,
	ctx: ExtensionContext,
): Promise<void> {
	if (argument === 'checkpoint') {
		ctx.compact()
		return
	}
	if (!argument && ctx.mode === 'tui' && ctx.hasUI) {
		await openLimitPicker(pi, ctx)
		return
	}
	if (argument && argument !== 'status') {
		await saveCeiling(pi, ctx, parseCeiling(argument))
		return
	}
	ctx.ui.notify(
		`${usageText(ctx)}; ${limitText(ctx)}. Pi auto-compaction is disabled. /context-budget opens the TUI picker; 192k or 192000 sets a limit; checkpoint saves a custom summary.`,
		'info',
	)
}

function registerBudgetCommand(pi: ExtensionAPI): void {
	pi.registerCommand('context-budget', {
		description:
			'Choose a live context limit; status, checkpoint, or a value such as 192k',
		handler: async (args, ctx) => {
			try {
				await handleCommand(args.trim(), pi, ctx)
			} catch (cause) {
				ctx.ui.notify(
					`Context Budget: ${cause instanceof Error ? cause.message : String(cause)}`,
					'error',
				)
			}
		},
	})
}

export default function contextBudget(pi: ExtensionAPI): void {
	registerContextGrowth(pi)
	registerBudgetCommand(pi)
	pi.on('session_before_compact', (event, ctx) => {
		if (event.reason !== 'manual') return { cancel: true } as const
		return summarize(event, ctx, pi.events)
	})
	pi.on('session_compact', (event, ctx) => {
		ctx.ui.notify(
			`Context checkpoint saved (${event.reason}); next usage measurement pending.`,
			'info',
		)
	})
	pi.on('session_compact_failed', (event, ctx) => {
		if (event.aborted) return
		ctx.ui.notify(
			`Context checkpoint failed (${event.reason}): ${event.errorMessage ?? 'see earlier checkpoint error'}.`,
			'warning',
		)
	})
}
