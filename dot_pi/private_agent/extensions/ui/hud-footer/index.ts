/**
 * hud-footer - flat riced style for light terminals (Catppuccin Latte).
 *
 * No filled pills: colored icons and tinted text sit directly on the
 * terminal background; groups are separated by thin verticals.
 * Line 1: 󰚩 model (↯ while a fallback chain model serves the session) │ ✻ thinking │ path │····· provider quotas
 * Line 2:  branch │ churn ▰▰▱▱ + counters │····· statuses (the model-fallback one rides line 1's pill), context gauge ▰▰▱▱▰▮▮▾ (usage fill, budget wall + fade-to-horizon band ≤4 cells) │ arrows │ cost
 *
 * The PR and review links form one contextual line above the prompt
 * (context-line.ts), visible only while at least one link exists.
 *
 * The cost group prices DeepSeek Flash turns at their own peak/off-peak tariff,
 * and the credit segment names the tier in effect and when it moves
 * (tariff-deepseek.ts). The bracketed [review] link opens the attached
 * Syneva desk for this Pi session (syneva-data.ts).
 */

import { BUDGET_SAVED_EVENT } from '#lib/context-budget/events.ts'
import { FALLBACK_STATUS_KEY } from '#lib/model-fallback/status.ts'

import { footerBudget } from './budget.ts'
import { footerComponent } from './component.ts'
import { mountContextLine, unmountContextLine } from './context-line.ts'
import {
	refreshGit,
	startGitTracking,
	stopGitTracking,
} from './git-tracking.ts'
import {
	refreshReviewForTurn,
	refreshPrForBranchChange,
	refreshQuotas,
	refreshTariff,
	startReviewPolling,
	startPrPolling,
	startQuotaPolling,
} from './poll-lifecycle.ts'
import { clampFooterLines, renderFooterLines } from './render.ts'
import { footerState, requestRenderSafely } from './state.ts'
import { deepseekTier } from './tariff-deepseek.ts'
import { shortPath } from './text.ts'
import { tokenTotals } from './tokens.ts'

import type {
	ContextUsage,
	ExtensionAPI,
	ExtensionContext,
	ReadonlyFooterDataProvider,
} from '@earendil-works/pi-coding-agent'
import type { FooterComponentDeps } from './component.ts'
import type { FooterRenderInput } from './render.ts'
import type { TokenTotals } from './tokens.ts'

function readThrough<T>(read: () => T, fallback: T): T {
	try {
		return read()
	} catch {
		return fallback
	}
}

function missingUsage(): ContextUsage {
	// Compaction and other gaps report unknown usage; render nothing
	return { percent: null, tokens: null, contextWindow: 0 }
}

function missingTokens(): TokenTotals {
	return { input: 0, output: 0, cost: 0 }
}

/** Footer statuses, plus whether the session runs on a fallback chain model. */
function extensionStatuses(footerData: ReadonlyFooterDataProvider): {
	statuses: string[]
	fallback: boolean
} {
	const entries = readThrough(
		() => [...footerData.getExtensionStatuses()],
		[],
	)
	// A live fallback status rides line 1's model pill (the ↯ icon) and
	// never renders in this statuses column
	const statuses = entries
		.filter(
			([key, status]) => Boolean(status) && key !== FALLBACK_STATUS_KEY,
		)
		.map(([, status]) => status)
	const fallback = entries.some(
		([key, status]) => key === FALLBACK_STATUS_KEY && Boolean(status),
	)
	return { statuses, fallback }
}

/** Build the full footer input, tolerating every pi accessor. */
function safeInput(
	ctx: ExtensionContext,
	footerData: ReadonlyFooterDataProvider,
): FooterRenderInput {
	const branchEntries = readThrough(() => ctx.sessionManager.getBranch(), [])
	const contextUsage = readThrough(
		() => ctx.getContextUsage(),
		missingUsage(),
	)
	const tokens = readThrough(
		() => tokenTotals(branchEntries, footerState.tariffCache),
		missingTokens(),
	)
	const modelId = readThrough(() => ctx.model?.id, undefined)
	const provider = readThrough(
		() => ctx.model?.provider,
		undefined,
	)?.toLowerCase()
	const modelWindow = readThrough(() => ctx.model?.contextWindow, undefined)
	const cwd = readThrough(() => ctx.cwd, process.cwd())
	const now = new Date()
	const { statuses, fallback } = extensionStatuses(footerData)
	return {
		width: 0,
		// an empty model id is not a real state; truthiness covers both shapes
		model: modelId ?? 'no-model',
		thinkingLevel: readThrough(() => ctx.thinkingLevel, 'off') ?? 'off',
		cwd: shortPath(cwd),
		branch: footerState.gitCache?.branch,
		usage: contextUsage,
		budget: footerBudget(modelWindow),
		tokens,
		statuses,
		fallback,
		git: footerState.gitCache,
		quotas: footerState.quotaCache,
		provider,
		tier: deepseekTier(footerState.tariffCache, now, provider, modelId),
		now,
	}
}

function footerLines(
	width: number,
	ctx: ExtensionContext,
	footerData: ReadonlyFooterDataProvider,
): string[] {
	try {
		const input = safeInput(ctx, footerData)
		return clampFooterLines(renderFooterLines({ ...input, width }), width)
	} catch {
		return ['']
	}
}

function installFooter(ctx: ExtensionContext): void {
	if (!footerState.isEnabled || ctx.mode !== 'tui') return
	startQuotaPolling()
	void refreshTariff()
	startGitTracking(ctx.cwd, refreshPrForBranchChange)
	startPrPolling()
	startReviewPolling(ctx)
	mountContextLine(ctx.ui)

	// Only install the footer component once - re-setFooter on every
	// session_start / toggle stacks ghost rows with the split-footer renderer.
	if (footerState.isFooterInstalled) {
		requestRenderSafely()
		return
	}
	footerState.isFooterInstalled = true

	ctx.ui.setFooter((tui, theme, footerData) =>
		footerComponent(tui, footerData, buildComponentDeps(ctx, footerData)),
	)
}

function buildComponentDeps(
	ctx: ExtensionContext,
	footerData: ReadonlyFooterDataProvider,
): FooterComponentDeps {
	return {
		requestRenderSafely,
		refreshGit,
		stopGitTracking,
		footerLines: width => footerLines(width, ctx, footerData),
	}
}

function teardownFooter(ui: ExtensionContext['ui']): void {
	stopGitTracking()
	unmountContextLine(ui)
	footerState.lifecycleGeneration += 1
	footerState.prGeneration += 1
	if (footerState.quotaTimer) clearInterval(footerState.quotaTimer)
	if (footerState.prTimer) clearInterval(footerState.prTimer)
	if (footerState.reviewTimer) clearInterval(footerState.reviewTimer)
	footerState.quotaTimer = null
	footerState.prTimer = null
	footerState.reviewTimer = null
	footerState.reviewCache = null
	footerState.gitCwd = null
	footerState.requestRender = null
	footerState.isFooterInstalled = false
}

function toggleFooter(ctx: ExtensionContext): void {
	footerState.isEnabled = !footerState.isEnabled
	if (footerState.isEnabled) {
		installFooter(ctx)
		ctx.ui.notify('Footer enabled', 'info')
		return
	}
	ctx.ui.setFooter(undefined)
	teardownFooter(ctx.ui)
	ctx.ui.notify('Default footer restored', 'info')
}

async function refreshQuotaCommand(ctx: ExtensionContext): Promise<void> {
	await refreshQuotas()
	ctx.ui.notify('Quotas refreshed', 'info')
}

/** A budget save lands on the shared bus; the gauge rereads its settings file. */
function subscribeBudgetSaves(events: ExtensionAPI['events']): void {
	if (!events || typeof events.on !== 'function') return
	events.on(BUDGET_SAVED_EVENT, () => requestRenderSafely())
}

export default function (pi: ExtensionAPI): void {
	subscribeBudgetSaves(pi.events)
	pi.on('session_start', (_event, ctx) => installFooter(ctx))
	pi.on('session_shutdown', (_event, ctx) => teardownFooter(ctx.ui))

	// Tool completion nudges the same serialized reader used by idle polling.
	pi.on('tool_execution_end', () => refreshGit())
	pi.on('turn_end', (_event, ctx) => {
		refreshGit()
		requestRenderSafely()
		refreshReviewForTurn(ctx)
	})
	pi.on('agent_end', () => requestRenderSafely())
	pi.on('thinking_level_select', () => requestRenderSafely())
	pi.on('model_select', () => requestRenderSafely())

	pi.registerCommand('hud-footer', {
		description: 'Toggle the powerline hud-footer',
		handler: async (_args, ctx) => toggleFooter(ctx),
	})

	pi.registerCommand('latte-quota', {
		description: 'Force-refresh provider quota display',
		handler: async (_args, ctx) => refreshQuotaCommand(ctx),
	})
}
