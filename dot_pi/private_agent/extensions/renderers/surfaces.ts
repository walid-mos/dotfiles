/** Pi user-content boundary. Leave native prompt zones and transcript selection intact. */
import { patchPiComponent } from '../ui/pi-component-patch.ts'
import { invokePiMethod, reflectMember } from '../ui/pi-members.ts'

import { PromptBlock } from './prompt-block.ts'

export function patchUserMessages(userClass: unknown): () => void {
	return patchPiComponent(userClass, 'pi.renderers.user', {
		rebuild(host) {
			const children = reflectMember(host, 'children')
			const existing: unknown = Array.isArray(children)
				? children.find(child => child instanceof PromptBlock)
				: undefined
			invokePiMethod(host, 'clear')
			const text = reflectMember(host, 'text')
			if (typeof text !== 'string' || !text.trim()) return
			const prompt =
				existing instanceof PromptBlock
					? existing
					: new PromptBlock(text)
			invokePiMethod(host, 'addChild', prompt)
		},
	})
}
