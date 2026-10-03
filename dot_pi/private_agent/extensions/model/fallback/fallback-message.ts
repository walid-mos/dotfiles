// Own the fallback continuation message contract and transcript presentation.
import { Text } from '@earendil-works/pi-tui'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export const FALLBACK_MESSAGE_TYPE = 'model-fallback'

export interface FallbackMessageDetails {
	failedModel?: string | undefined
	candidate?: string | undefined
	reason?: string | undefined
}

export function registerFallbackRenderer(pi: ExtensionAPI): void {
	pi.registerMessageRenderer<FallbackMessageDetails>(
		FALLBACK_MESSAGE_TYPE,
		(message, { expanded, outputPad }, theme) => {
			const { failedModel, candidate, reason } = message.details ?? {}
			const summary = `↯ ${failedModel ?? 'the previous model'} failed (${reason ?? 'provider error'}) → fallback ${candidate ?? 'the next model'}`
			const detail = expanded
				? `\n  the turn restarted on ${candidate ?? 'the next model'}; completed work is kept`
				: ''
			return new Text(theme.fg('dim', summary + detail), outputPad, 0)
		},
	)
}
