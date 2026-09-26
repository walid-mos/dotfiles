/**
 * Suppress automatic goal continuation after an explicitly aborted run.
 *
 * An abort surfaces in one of two shapes at `agent_end`. When Escape cuts the
 * model mid-stream, the last message is the assistant message with stopReason
 * `aborted`. When Escape cancels a running tool call, the loop ends the run at
 * `shouldStopAfterTurn` with the last message an error toolResult - no aborted
 * assistant message is ever created - so the only reliable witness is the run's
 * abort signal, which is still live while `agent_end` listeners execute. Both
 * are checked.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'

type RunMessage = {
	role?: string
	stopReason?: string
}

export class AgentAbortPause {
	private isPaused = false

	get pending(): boolean {
		return this.isPaused
	}

	startRun(): void {
		this.isPaused = false
	}

	endRun(messages: RunMessage[], signal: AbortSignal | undefined): void {
		const last = messages.at(-1)
		this.isPaused =
			signal?.aborted === true ||
			(last?.role === 'assistant' && last.stopReason === 'aborted')
	}
}

export function watchAgentAborts(
	pi: ExtensionAPI,
	pause: AgentAbortPause,
): void {
	pi.on('agent_start', () => pause.startRun())
	pi.on('agent_end', (event, ctx: ExtensionContext) =>
		pause.endRun(event.messages, ctx.signal),
	)
}
