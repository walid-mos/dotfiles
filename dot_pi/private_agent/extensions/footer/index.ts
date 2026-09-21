/**
 * Footer - flat riced style for light terminals (Catppuccin Latte).
 *
 * No filled pills: colored icons and tinted text sit directly on the
 * terminal background; groups are separated by thin verticals.
 * Line 1: 󰚩 model │ ✻ thinking │ path │····· statuses │ context gauge ▰▰▱▱ │ arrows │ cost
 * Line 2:  branch │ churn ▰▰▱▱ + counters │····· provider quotas
 *
 * The container status, the PR link and the review link left the footer: they
 * form one contextual line above the prompt (context-line.ts), mounted at the
 * highest above-editor priority and only visible while one of the three exists.
 *
 * The cost group prices DeepSeek Flash turns at their own peak/off-peak tariff,
 * and the credit segment names the tier in effect and when it moves
 * (tariff-deepseek.ts). The bracketed [review] link opens the live Galley
 * review desk for this repo while one runs (galley-data.ts).
 */

import { CONTAINER_STATUS_KEY } from '../container-sandbox/runtime.ts'

import { footerComponent } from './component.ts'
import { mountContextLine, unmountContextLine } from './context-line.ts'
import {
	refreshGalleyForTurn,
	refreshPrForBranchChange,
	refreshQuotas,
	refreshTariff,
	refreshGitForTurn,
	startGalleyPolling,
	startGitTracking,
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

function missingTokens(): { input: number; output: number; cost: number } {
	return { input: 0, output: 0, cost: 0 }
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
	const cwd = readThrough(() => ctx.cwd, process.cwd())
	const now = new Date()
	return {
		width: 0,
		// an empty model id is not a real state; truthiness covers both shapes
		model: modelId ?? 'no-model',
		thinkingLevel: readThrough(() => ctx.thinkingLevel, 'off') ?? 'off',
		cwd: shortPath(cwd),
		branch: readThrough(
			() => footerData.getGitBranch() ?? undefined,
			undefined,
		),
		usage: contextUsage,
		tokens,
		statuses: readThrough(
			() =>
				[...footerData.getExtensionStatuses()]
					// The container workspace lives in the context line above the prompt
					.filter(
						([key, status]) =>
							key !== CONTAINER_STATUS_KEY && Boolean(status),
					)
					.map(([, status]) => status),
			[],
		),
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
	if (!footerState.isEnabled) return
	startQuotaPolling()
	void refreshTariff()
	startGitTracking(ctx.cwd)
	startPrPolling(ctx.cwd)
	startGalleyPolling(ctx.cwd)
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
		refreshPrForBranchChange,
		footerLines: width => footerLines(width, ctx, footerData),
	}
}

function teardownFooter(ui: ExtensionContext['ui']): void {
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
		footerState.isFooterInstalled = false
		installFooter(ctx)
		ctx.ui.notify('Footer enabled', 'info')
		return
	}
	ctx.ui.setFooter(undefined)
	unmountContextLine(ctx.ui)
	footerState.isFooterInstalled = false
	footerState.requestRender = null
	ctx.ui.notify('Default footer restored', 'info')
}

async function refreshQuotaCommand(ctx: ExtensionContext): Promise<void> {
	await refreshQuotas()
	ctx.ui.notify('Quotas refreshed', 'info')
}

export default function (pi: ExtensionAPI): void {
	pi.on('session_start', (_event, ctx) => installFooter(ctx))
	pi.on('session_shutdown', (_event, ctx) => teardownFooter(ctx.ui))

	// Refresh stats after each turn: branch churn and the review link both move
	// while the agent works, so neither needs a timer
	pi.on('turn_end', () => {
		refreshGitForTurn()
		requestRenderSafely()
		const cwd = footerState.gitCwd
		if (cwd) refreshGalleyForTurn(cwd)
	})
	pi.on('agent_end', () => requestRenderSafely())
	pi.on('thinking_level_select', () => requestRenderSafely())
	pi.on('model_select', () => requestRenderSafely())

	pi.registerCommand('footer', {
		description: 'Toggle the powerline footer',
		handler: async (_args, ctx) => toggleFooter(ctx),
	})

	pi.registerCommand('latte-quota', {
		description: 'Force-refresh provider quota display',
		handler: async (_args, ctx) => refreshQuotaCommand(ctx),
	})
}
