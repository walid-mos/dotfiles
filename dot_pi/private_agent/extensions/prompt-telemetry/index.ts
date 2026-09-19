/**
 * prompt-telemetry - live telemetry for the request being served, rendered as
 * an activity block inside the editor's top border.
 *
 * The block tracks the current prompt only: animated clock and elapsed track,
 * input / output / cache tokens and the output rate. Streamed characters are
 * counted into a `~`-marked estimate until the provider reports exact usage at
 * each turn end; the rate divides output by streamed time only, never by wall
 * time spent in tools or waiting for the user. When the agent settles the block
 * freezes as `✓ mm:ss` and stays there until the next prompt takes the line over.
 *
 * Placement: the border is where pi draws its own working loader, so our loader
 * is embedded there (same left alignment) and the activity block sits flush with
 * that border's right edge, wearing the loading color, instead of taking a line
 * of its own under it. Time is read at render, so pi's own render loop animates
 * the block: the extension keeps no timer at all.
 *
 * Modules:
 *   state.ts          - prompt/turn telemetry state machine (pure, timer-free)
 *   render.ts         - the activity block renderer (clock, track, token counts)
 *   session.ts        - block lifetime owner (tracked prompt and repaint)
 *   activity-border.ts - editor top-border hook embedding and placing it
 */

import {
	createDefaultEditor,
	registerEditorDecorator,
} from '../ui/editor-decorator.ts'

import { installActivityBorder } from './activity-border.ts'
import { TelemetrySession } from './session.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export default function promptTelemetry(pi: ExtensionAPI): void {
	const session = new TelemetrySession()

	registerEditorDecorator(
		pi,
		createDefaultEditor,
		(base, _keybindings, tui) => {
			session.bindRepaint(() => tui.requestRender())
			installActivityBorder(base, (width, paint) =>
				session.renderActivity(width, paint),
			)
			return base
		},
	)

	pi.on('session_start', () => session.start())
	pi.on('before_agent_start', () => session.startPrompt())
	pi.on('turn_start', () => session.startTurn())
	pi.on('message_update', event =>
		session.recordDelta(event.assistantMessageEvent),
	)
	pi.on('turn_end', event => session.recordUsage(event.message))
	pi.on('agent_settled', () => session.settle())
	pi.on('session_shutdown', () => session.stop())
}
