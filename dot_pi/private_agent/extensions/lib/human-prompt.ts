import type { InputEvent } from '@earendil-works/pi-coding-agent'

/** Only submitted human prompts retire transient UI; extension continuations do not. */
export function isHumanPrompt(event: InputEvent): boolean {
	return event.source === 'interactive' || event.source === 'rpc'
}

/** Pi and inline-skills expand `/name args` into this block before the input event fires. */
const SKILL_EXPANSION = /<skill name="([^"]+)"[^>]*>[\s\S]*?<\/skill>/gu

/** What the human typed: every expanded skill block collapses back to its slash command. */
export function typedPromptText(text: string): string {
	return text.replace(SKILL_EXPANSION, '/$1')
}
