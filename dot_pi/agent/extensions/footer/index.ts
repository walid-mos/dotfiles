/**
 * Footer - flat riced style for light terminals (Catppuccin Latte).
 *
 * No filled pills: colored icons and tinted text sit directly on the
 * terminal background; groups are separated by thin verticals.
 * Line 1: 󰚩 model │ ✻ thinking │ path │····· statuses │ context gauge ▰▰▱▱ │ arrows │ cost
 * Line 2:  branch │ churn ▰▰▱▱ + counters + [PR #n] │····· provider quotas
 *
 * The cost group prices DeepSeek Flash turns at their own peak/off-peak tariff,
 * and the credit segment names the tier in effect and when it moves
 * (tariff-deepseek.ts).
 */

import { footerComponent } from './component.ts'
import { fetchCurrentPr, fetchGitStatus } from './git-data.ts'
import { GIT_POLL_MS, PR_POLL_MS, QUOTA_POLL_MS } from './poll-pace.ts'
import { pollQuotas } from './poll-quotas.ts'
import { clampFooterLines, renderFooterLines } from './render.ts'
import { footerState } from './state.ts'
import { pollDeepseekTariff } from './tariff-catalogue.ts'
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

function requestRenderSafely(): void {
	try {
		footerState.requestRender?.()
	} catch {
		footerState.requestRender = null
	}
}

async function refreshQuotas(): Promise<void> {
	const lifecycle = footerState.lifecycleGeneration
	try {
		const quotas = await pollQuotas()
		if (lifecycle !== footerState.lifecycleGeneration) return
		footerState.quotaCache = quotas
		requestRenderSafely()
	} catch {
		// Quota APIs are decorative; a provider/network failure must never escape a timer.
	}
}

function startQuotaPolling(): void {
	if (footerState.quotaTimer) return
	void refreshQuotas()
	footerState.quotaTimer = setInterval(
		() => void refreshQuotas(),
		QUOTA_POLL_MS,
	)
	footerState.quotaTimer.unref()
}

/**
 * Load the DeepSeek tariff once per session: the schedule moves with DeepSeek's
 * price list, not with the clock, and the tier is read at render time.
 */
async function refreshTariff(): Promise<void> {
	const lifecycle = footerState.lifecycleGeneration
	try {
		const tariff = await pollDeepseekTariff()
		if (lifecycle !== footerState.lifecycleGeneration) return
		if (!tariff) return
		footerState.tariffCache = tariff
		requestRenderSafely()
	} catch {
		// Pricing is decorative; pi's own single-rate cost stays in place.
	}
}

async function refreshGit(cwd: string): Promise<void> {
	const lifecycle = footerState.lifecycleGeneration
	try {
		const status = await fetchGitStatus(cwd)
		if (lifecycle !== footerState.lifecycleGeneration) return
		footerState.gitCache = status
		requestRenderSafely()
	} catch {
		// Git status is decorative; never reject from an interval callback.
	}
}

function startGitPolling(cwd: string): void {
	footerState.gitCwd = cwd
	if (footerState.gitTimer) {
		void refreshGit(cwd)
		return
	}
	void refreshGit(cwd)
	footerState.gitTimer = setInterval(() => {
		if (footerState.gitCwd) void refreshGit(footerState.gitCwd)
	}, GIT_POLL_MS)
	footerState.gitTimer.unref()
}

async function refreshPr(cwd: string): Promise<void> {
	footerState.prGeneration += 1
	const generation = footerState.prGeneration
	const lifecycle = footerState.lifecycleGeneration
	try {
		const nextPr = await fetchCurrentPr(cwd)
		const isStale =
			generation !== footerState.prGeneration ||
			lifecycle !== footerState.lifecycleGeneration
		if (isStale) return
		const unchanged =
			footerState.prCache?.number === nextPr?.number &&
			footerState.prCache?.url === nextPr?.url
		if (unchanged) return
		footerState.prCache = nextPr
		requestRenderSafely()
	} catch {
		// GitHub status is decorative; never reject from an interval callback.
	}
}

function startPrPolling(cwd: string): void {
	void refreshPr(cwd)
	if (footerState.prTimer) return
	footerState.prTimer = setInterval(() => {
		if (footerState.gitCwd) void refreshPr(footerState.gitCwd)
	}, PR_POLL_MS)
	footerState.prTimer.unref()
}

function refreshPrForBranchChange(): void {
	footerState.prCache = null
	requestRenderSafely()
	if (footerState.gitCwd) void refreshPr(footerState.gitCwd)
}

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
				[...footerData.getExtensionStatuses().values()].filter(Boolean),
			[],
		),
		git: footerState.gitCache,
		pr: footerState.prCache,
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
	startGitPolling(ctx.cwd)
	startPrPolling(ctx.cwd)

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

function teardownFooter(): void {
	footerState.lifecycleGeneration += 1
	footerState.prGeneration += 1
	if (footerState.quotaTimer) clearInterval(footerState.quotaTimer)
	if (footerState.gitTimer) clearInterval(footerState.gitTimer)
	if (footerState.prTimer) clearInterval(footerState.prTimer)
	footerState.quotaTimer = null
	footerState.gitTimer = null
	footerState.prTimer = null
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
	pi.on('session_shutdown', () => teardownFooter())

	// Refresh stats after each turn
	pi.on('turn_end', () => requestRenderSafely())
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
