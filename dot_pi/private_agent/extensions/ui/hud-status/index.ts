import { createWorkingRotation, defaultIntervalScheduler } from './rotation.ts'
import { createShuffleBag } from './shuffle-bag.ts'
import { HUD_STATUS_WORDS } from './words.ts'

/**
 * hud-status - hide persistent "Thinking..." from the transcript and rotate a calm
 * working label on the prompt's top border while the agent is busy: one word drawn
 * from the shuffle bag every three seconds, paused while a questionnaire waits
 * for the user.
 */
import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { WorkingRotation } from './rotation.ts'

export default function agentStatus(pi: ExtensionAPI): void {
	const bag = createShuffleBag(HUD_STATUS_WORDS)
	let rotation: WorkingRotation | undefined

	function startRotation(ctx: ExtensionContext): void {
		rotation?.stop()
		rotation = createWorkingRotation({
			rotate: () => {
				ctx.ui.setWorkingMessage(`${bag.next()}...`)
			},
			hideTranscriptThinking: () => {
				ctx.ui.setHiddenThinkingLabel('')
			},
			restoreWorkingMessage: () => {
				ctx.ui.setWorkingMessage()
			},
			restoreDefaults: () => {
				ctx.ui.setHiddenThinkingLabel()
				ctx.ui.setWorkingMessage()
			},
			scheduler: defaultIntervalScheduler,
		})
		rotation.start()
	}

	function stopRotation(): void {
		rotation?.stop()
	}

	pi.on('session_start', async (_event, ctx) => {
		ctx.ui.setHiddenThinkingLabel('')
	})

	pi.on('agent_start', async (_event, ctx) => {
		startRotation(ctx)
	})

	pi.on('agent_end', async () => {
		stopRotation()
	})

	// The questionnaire replaces the editor and waits for the user; a rotating
	// "working" label would be misleading during that pause.
	pi.on('tool_execution_start', async event => {
		if (event.toolName !== 'ask_user_question') return
		stopRotation()
	})

	pi.on('tool_execution_end', async (event, ctx) => {
		if (event.toolName !== 'ask_user_question') return
		startRotation(ctx)
	})

	pi.on('session_shutdown', async () => {
		rotation?.shutdown()
		rotation = undefined
	})
}
