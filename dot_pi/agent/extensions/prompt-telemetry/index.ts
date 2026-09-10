/**
 * prompt-telemetry - live telemetry for the request being served, printed as a
 * muted line directly under the "Thinking…" status of the prompt border.
 *
 * The line tracks the current prompt only: animated clock and elapsed track,
 * input / output / cache tokens and the output rate. Streamed characters are
 * counted into a `~`-marked estimate until the provider reports exact usage at
 * each turn end; the rate divides output by streamed time only, never by wall
 * time spent in tools or waiting for the user. When the agent settles the line
 * freezes as `✓ mm:ss` and clears itself twenty seconds later.
 *
 * Placement: pi embeds the working status in the editor's top border, so being
 * under the thinking means decorating the editor and inserting one line after
 * that border. Time is read at render, so pi's own render loop animates the
 * line; the only timer is the one that retires the frozen line.
 *
 * Modules:
 *   state.ts            - prompt/turn telemetry state machine (pure, timer-free)
 *   render.ts           - the one-line renderer (clock, track, token counts)
 *   session.ts          - line lifetime owner (tracked prompt, repaint, linger)
 *   telemetry-editor.ts - editor render hook inserting the line
 */

import { CustomEditor } from '@earendil-works/pi-coding-agent'

import { registerEditorDecorator } from '../ui/editor-decorator.ts'

import { TelemetrySession } from './session.ts'
import { installTelemetryLine } from './telemetry-editor.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export default function promptTelemetry(pi: ExtensionAPI): void {
	const session = new TelemetrySession()

	registerEditorDecorator(
		pi,
		(tui, theme, keybindings) => new CustomEditor(tui, theme, keybindings),
		(base, _keybindings, tui) => {
			session.bindRepaint(() => tui.requestRender())
			installTelemetryLine(base, width => session.renderLine(width))
			return base
		},
	)

	pi.on('session_start', (_event, ctx) => session.start(() => ctx.ui.theme))
	pi.on('before_agent_start', () => session.startPrompt())
	pi.on('turn_start', () => session.startTurn())
	pi.on('message_update', event =>
		session.recordDelta(event.assistantMessageEvent),
	)
	pi.on('turn_end', event => session.recordUsage(event.message))
	pi.on('agent_settled', () => session.settle())
	pi.on('session_shutdown', () => session.stop())
}
