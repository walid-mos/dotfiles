/**
 * Editor render hook: insert the telemetry line right after the editor's top
 * border.
 *
 * Pi embeds the working status ("Thinking…") in that border line, so the only
 * place that is truly *under* the thinking is inside the editor component. A
 * surface widget around the editor would land above the border instead.
 */

import type { EditorComponent } from '@earendil-works/pi-tui'

/** Renders the line for a given terminal width, or nothing while inactive. */
export type TelemetryLineReader = (width: number) => string | undefined

export function installTelemetryLine(
	editor: EditorComponent,
	readLine: TelemetryLineReader,
): void {
	const originalRender = editor.render.bind(editor)
	// oxlint-disable-next-line no-param-reassign
	editor.render = (width: number): string[] => {
		const lines = originalRender(width)
		const line = readLine(width)
		if (!line) return lines
		return [lines[0] ?? '', line, ...lines.slice(1)]
	}
}
