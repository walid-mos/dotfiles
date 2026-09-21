/** Persistent drift notice while the running Pi release is newer than the audited adapters. */
import {
	ABOVE_EDITOR_PRIORITY,
	setOrderedSurfaceWidget,
} from './ordered-widget-stack.ts'

import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent'
import type { PiVersionDrift } from './pi-runtime.ts'

const WIDGET_ID = 'pi-renderer-drift'

function driftLine(drift: PiVersionDrift): string {
	return `⚠ pi ${drift.runningVersion} - display adapters audited for ${drift.auditedVersion} · run /skill:pi-renderer-update`
}

/** Mount the warning above the editor, under the context line; replaces any previous line. */
export function showRendererDrift(
	ui: ExtensionUIContext,
	drift: PiVersionDrift,
): void {
	const line = driftLine(drift)
	setOrderedSurfaceWidget(ui, WIDGET_ID, {
		priority: ABOVE_EDITOR_PRIORITY.driftWarning,
		render: (_width, theme) => [theme.fg('warning', line)],
	})
}
