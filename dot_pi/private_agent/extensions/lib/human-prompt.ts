import type { InputEvent } from '@earendil-works/pi-coding-agent'

/** Only submitted human prompts retire transient UI; extension continuations do not. */
export function isHumanPrompt(event: InputEvent): boolean {
	return event.source === 'interactive' || event.source === 'rpc'
}
