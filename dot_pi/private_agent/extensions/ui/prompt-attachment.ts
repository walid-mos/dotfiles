/** Cross-extension contract for display-only content that belongs above a prompt's text. */
import { reflectMember, typedHost } from './pi-members.ts'

import type { Component } from '@earendil-works/pi-tui'

export const PROMPT_ATTACHMENT = Symbol.for('pi.prompt-attachment')

export interface PromptAttachment extends Component {
	readonly [PROMPT_ATTACHMENT]: true
	matchesPrompt(source: string): boolean
}

export function isPromptAttachment(
	content: unknown,
): content is PromptAttachment {
	const host = typedHost(content)
	return Boolean(
		host &&
		Reflect.get(host, PROMPT_ATTACHMENT) === true &&
		typeof reflectMember(host, 'matchesPrompt') === 'function' &&
		typeof reflectMember(host, 'render') === 'function' &&
		typeof reflectMember(host, 'invalidate') === 'function',
	)
}
