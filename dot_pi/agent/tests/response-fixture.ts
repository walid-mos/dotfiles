/** Deterministic provider messages; rendering tests use Pi's actual assistant component. */
import type { AssistantMessage } from '@earendil-works/pi-ai'

export function assistantMessage(
	content: string | AssistantMessage['content'],
	stopReason: AssistantMessage['stopReason'] = 'stop',
): AssistantMessage {
	return {
		role: 'assistant',
		content:
			typeof content === 'string'
				? [{ type: 'text', text: content }]
				: content,
		api: 'anthropic-messages',
		provider: 'test-provider',
		model: 'test-model',
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0,
			},
		},
		stopReason,
		timestamp: 0,
	}
}
