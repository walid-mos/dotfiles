// Footer polling lifecycle: timers, refresh passes and the caches they fill.
// Decorative on every path: a provider, fs, git or GitHub failure must never
// escape an interval callback, and a refresh landing after a teardown or
// install drops through its captured lifecycle generation instead of
// resurrecting a stale cache in a dead footer.
import { fetchCurrentPr } from './git-data.ts'
import { PR_POLL_MS, QUOTA_POLL_MS, REVIEW_POLL_MS } from './poll-pace.ts'
import { pollQuotas } from './poll-quotas.ts'
import { footerState, requestRenderSafely } from './state.ts'
import { fetchAttachedSynevaDesk } from './syneva-data.ts'
import { pollDeepseekTariff } from './tariff-catalogue.ts'

import type { ExtensionContext } from '@earendil-works/pi-coding-agent'

// ── Provider quotas ─────────────────────────────────

/** One refresh pass; also runs on demand via the latte-quota command. */
export async function refreshQuotas(): Promise<void> {
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

export function startQuotaPolling(): void {
	if (footerState.quotaTimer) return
	void refreshQuotas()
	footerState.quotaTimer = setInterval(
		() => void refreshQuotas(),
		QUOTA_POLL_MS,
	)
	footerState.quotaTimer.unref()
}

// ── DeepSeek tariff (read once per session) ──────────

/**
 * Load the DeepSeek tariff once per session: the schedule moves with DeepSeek's
 * price list, not with the clock, and the tier is read at render time.
 */
export async function refreshTariff(): Promise<void> {
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

// ── GitHub PR ────────────────────────────────────────

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

export function startPrPolling(): void {
	if (footerState.prTimer) return
	footerState.prTimer = setInterval(() => {
		if (footerState.gitCwd) void refreshPr(footerState.gitCwd)
	}, PR_POLL_MS)
	footerState.prTimer.unref()
}

export function refreshPrForBranchChange(): void {
	footerState.prCache = null
	requestRenderSafely()
	if (footerState.gitCwd) void refreshPr(footerState.gitCwd)
}

// ── Attached Syneva review desk ───────────────────────

async function refreshReview(ctx: ExtensionContext): Promise<void> {
	const lifecycle = footerState.lifecycleGeneration
	try {
		const desk = await fetchAttachedSynevaDesk(ctx.sessionManager)
		if (lifecycle !== footerState.lifecycleGeneration) return
		const unchanged =
			footerState.reviewCache?.session === desk?.session &&
			footerState.reviewCache?.url === desk?.url
		if (unchanged) return
		footerState.reviewCache = desk
		requestRenderSafely()
	} catch {
		// The review link is decorative; never reject from an interval callback.
	}
}

export function startReviewPolling(ctx: ExtensionContext): void {
	void refreshReview(ctx)
	if (footerState.reviewTimer) return
	footerState.reviewTimer = setInterval(
		() => void refreshReview(ctx),
		REVIEW_POLL_MS,
	)
	footerState.reviewTimer.unref()
}

/** Nudge between turns: a desk tends to start or stop while the agent runs. */
export function refreshReviewForTurn(ctx: ExtensionContext): void {
	void refreshReview(ctx)
}
