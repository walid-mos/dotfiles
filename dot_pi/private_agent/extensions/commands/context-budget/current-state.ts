/** Small, observed evidence supplement from the full edited projection, not just its old prefix. */
import { commandEvidence, evidenceText } from '#lib/command-evidence/schema.ts'

import type { ExtensionContext } from '@earendil-works/pi-coding-agent'

const MAX_RECENT_RESULTS = 8
const MAX_RESULT_CHARS = 1200

export function currentCheckpointState(ctx: ExtensionContext): string {
	const { messages } = ctx.sessionManager.buildSessionProjection()
	const observed = messages
		.filter(
			message =>
				message.role === 'toolResult' && message.toolName === 'bash',
		)
		.slice(-MAX_RECENT_RESULTS)
	const results = observed.map(message => {
		if (message.role !== 'toolResult') return ''
		const text = message.content
			.filter(part => part.type === 'text')
			.map(part => part.text)
			.join('\n')
		return `Call ${message.toolCallId}; tool error: ${message.isError}; reported output tail (not an inferred suite status):\n${text.slice(-MAX_RESULT_CHARS)}`
	})
	const saved = commandEvidence(ctx.sessionManager.getBranch())
		.slice(-MAX_RECENT_RESULTS)
		.map(record =>
			evidenceText({
				...record,
				command:
					record.command.length > MAX_RESULT_CHARS
						? `${record.command.slice(0, MAX_RESULT_CHARS)} [command truncated; full command in receipt]`
						: record.command,
			}),
		)
	return [
		'This bounded supplement uses the full projected session and current branch evidence. Absence here is NOT proof a command never ran. Later retained messages take precedence over this snapshot. Tool success alone does not establish the exit status of an upstream pipeline.',
		...saved,
		...results,
	].join('\n\n')
}
