/**
 * Render live prompt activity inside the editor's top border.
 *
 * session.ts owns live usage and stream estimates; activity-border.ts owns
 * placement. Pi's render loop supplies repaints, with no extension timer.
 * timing-wiring.ts independently registers stored measurements and /latency.
 */
import {
	createDefaultEditor,
	registerEditorDecorator,
} from '#lib/ui/editor-decorator.ts'

import { installActivityBorder } from './activity-border.ts'
import { TelemetrySession } from './session.ts'
import { registerPromptTimings } from './timing-wiring.ts'

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

	registerPromptTimings(pi)
}
