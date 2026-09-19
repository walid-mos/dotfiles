import { createShuffleBag, workingMessage } from './shuffle-bag.ts'
import { THINKING_WORKING_WORDS } from './words.ts'

/**
 * Hide persistent "Thinking..." from the transcript and raise ONE calm working label
 * below the chat while the agent is busy. Calm by design: the label is drawn once per
 * agent run - no rotation, no timers, no blink. (The `rotation.ts` machinery is kept
 * for recovery if rotation is ever wanted again, but nothing wires it in today.)
 */
import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'

export default function thinkingWorking(pi: ExtensionAPI): void {
	const bag = createShuffleBag(THINKING_WORKING_WORDS)

	function showStaticLabel(ctx: ExtensionContext): void {
		ctx.ui.setHiddenThinkingLabel('')
		ctx.ui.setWorkingMessage(workingMessage(bag.next()))
	}

	pi.on('session_start', async (_event, ctx) => {
		ctx.ui.setHiddenThinkingLabel('')
	})

	pi.on('agent_start', async (_event, ctx) => {
		showStaticLabel(ctx)
	})

	pi.on('agent_end', async (_event, ctx) => {
		ctx.ui.setWorkingMessage()
	})

	// This tool replaces the editor with a questionnaire and waits for the user.
	// A "working" indicator would be misleading during that pause.
	pi.on('tool_execution_start', async (_event, ctx) => {
		ctx.ui.setWorkingMessage()
	})

	pi.on('tool_execution_end', async (event, ctx) => {
		if (event.toolName !== 'ask_user_question') return
		showStaticLabel(ctx)
	})

	pi.on('session_shutdown', async (_event, ctx) => {
		ctx.ui.setHiddenThinkingLabel()
		ctx.ui.setWorkingMessage()
	})
}
