// Shared mutable state of the footer extension. The extension is a process
// singleton per pi session; module state mirrors the adapter-map pattern used
// by the other pi extensions (e.g. ordered-widget-stack). Mutable handles are
// nullable, never optional: clearing sets null (see runtimeState in a sibling
// extension for the same idiom).
import type { GalleyDesk } from './galley-data.ts'
import type { GitPr, GitStatus } from './git-data.ts'
import type { QuotaCache } from './quotas.ts'
import type { DeepseekTariff } from './tariff-deepseek.ts'

export type FooterState = {
	isEnabled: boolean
	requestRender: (() => void) | null
	quotaCache: QuotaCache
	quotaTimer: ReturnType<typeof setInterval> | null
	tariffCache: DeepseekTariff | null
	gitCache: GitStatus | null
	gitTimer: ReturnType<typeof setInterval> | null
	gitCwd: string | null
	prCache: GitPr | null
	prTimer: ReturnType<typeof setInterval> | null
	prGeneration: number
	reviewCache: GalleyDesk | null
	reviewTimer: ReturnType<typeof setInterval> | null
	lifecycleGeneration: number
	isFooterInstalled: boolean
}

export const footerState: FooterState = {
	isEnabled: true,
	requestRender: null,
	quotaCache: {},
	quotaTimer: null,
	tariffCache: null,
	gitCache: null,
	gitTimer: null,
	gitCwd: null,
	prCache: null,
	prTimer: null,
	prGeneration: 0,
	reviewCache: null,
	reviewTimer: null,
	lifecycleGeneration: 0,
	isFooterInstalled: false,
}

/** Ask for a TUI repaint; a dead TUI handle drops instead of throwing. */
export function requestRenderSafely(): void {
	try {
		footerState.requestRender?.()
	} catch {
		footerState.requestRender = null
	}
}
