import { hyperlink } from '@earendil-works/pi-tui'

/**
 * Contextual line above the prompt: container · review desk · PR link.
 *
 * One line rendered through the shared ordered widget stack at the highest
 * above-editor priority, and only when at least one of the three exists - it
 * renders nothing otherwise. Segments:
 * - container: a bracketed `[container]` label, shown only while the sandbox runtime is
 *   active (runtime.ts activity seam), hyperlinked to the workspace's tailnet URL when
 *   container-sandbox published one (link seam, read once per activation, never here).
 * - review / PR: the footer's own caches (poll-lifecycle.ts), same sources the
 *   footer's line 2 used to render as links.
 */
import {
	publishedContainerLink,
	sandboxActive,
} from '../container-sandbox/runtime.ts'
import { PI_PALETTE as LATTE } from '../ui/design-system/palette.ts'
import { foregroundHex as fgHex } from '../ui/design-system/terminal-color.ts'
import {
	ABOVE_EDITOR_PRIORITY,
	setOrderedAboveEditorWidget,
} from '../ui/ordered-widget-stack.ts'

import { prLink, reviewLink } from './render-git.ts'
import { footerState } from './state.ts'
import { bracketed, thinSep } from './text.ts'

import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent'

export const CONTEXT_LINE_WIDGET_ID = 'footer-context-line'

/** The workspace segment: bracketed label, hyperlinked when a tailnet URL exists. */
function containerSegment(): string | null {
	if (!sandboxActive()) return null
	const label = bracketed(fgHex(LATTE.teal, 'container'))
	const url = publishedContainerLink()
	return url ? hyperlink(label, url) : label
}

/** The context line, container · review · PR, joined by the footer's thin separator. */
export function contextLine(): string[] {
	const segments = [
		containerSegment(),
		reviewLink(footerState.reviewCache),
		prLink(footerState.prCache),
	].filter(Boolean)
	return segments.length > 0 ? [segments.join(` ${thinSep()} `)] : []
}

/** Mount the line for the session; it shows itself only while a segment exists. */
export function mountContextLine(ui: ExtensionUIContext): void {
	setOrderedAboveEditorWidget(ui, CONTEXT_LINE_WIDGET_ID, {
		priority: ABOVE_EDITOR_PRIORITY.contextLine,
		render: contextLine,
	})
}

/** Unmount the line; the next session mounts its own. */
export function unmountContextLine(ui: ExtensionUIContext): void {
	setOrderedAboveEditorWidget(ui, CONTEXT_LINE_WIDGET_ID, undefined)
}
