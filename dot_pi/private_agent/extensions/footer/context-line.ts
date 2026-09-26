/**
 * Contextual line above the prompt: review desk · PR link.
 *
 * Rendered through the shared ordered widget stack only when a review or PR
 * link exists. Both come from the footer's caches (poll-lifecycle.ts).
 */
import {
	ABOVE_EDITOR_PRIORITY,
	setOrderedAboveEditorWidget,
} from '../ui/ordered-widget-stack.ts'

import { prLink, reviewLink } from './render-git.ts'
import { footerState } from './state.ts'
import { thinSep } from './text.ts'

import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent'

export const CONTEXT_LINE_WIDGET_ID = 'footer-context-line'

/** Join review and PR links with the footer's thin separator. */
export function contextLine(): string[] {
	const segments = [
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
