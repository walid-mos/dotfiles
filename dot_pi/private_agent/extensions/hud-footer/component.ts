import { footerState } from './state.ts'

// Footer component mounted through pi's setFooter lifecycle: tracks the
// request-render handle, keeps PR polling reactive to branch changes and
// re-renders with the latest cached data on every frame.
import type { ReadonlyFooterDataProvider } from '@earendil-works/pi-coding-agent'
import type { Component, TUI } from '@earendil-works/pi-tui'

export type FooterComponentDeps = {
	requestRenderSafely(): void
	refreshPrForBranchChange(): void
	footerLines(width: number): string[]
}

/** Compose the pi footer component around poller-provided callbacks. */
export function footerComponent(
	tui: TUI,
	footerData: ReadonlyFooterDataProvider,
	deps: FooterComponentDeps,
): Component & { dispose(): void } {
	footerState.requestRender = () => tui.requestRender()
	const unsubscribeBranch = footerData.onBranchChange(() => {
		tui.requestRender()
		deps.refreshPrForBranchChange()
	})

	return {
		dispose(): void {
			unsubscribeBranch()
			footerState.isFooterInstalled = false
			footerState.requestRender = null
		},
		// Render hooks run every frame anyway; nudge a repaint on invalidation.
		invalidate(): void {
			deps.requestRenderSafely()
		},
		render(width: number): string[] {
			return deps.footerLines(width)
		},
	}
}
