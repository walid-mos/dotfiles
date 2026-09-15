/** Pi 0.85.1 entry boundary: move owned attachment entries into their preceding prompt. */
import { patchPiComponent } from '../ui/pi-component-patch.ts'
import {
	invokePiMethod,
	reflectMember,
	renderPiComponent,
} from '../ui/pi-members.ts'
import {
	isPromptAttachment,
	PROMPT_ATTACHMENT,
} from '../ui/prompt-attachment.ts'

import { PromptBlock } from './prompt-block.ts'

import type { PromptAttachment } from '../ui/prompt-attachment.ts'

const ENTRY_SPACING_ROWS = 1

/** Keep Pi's native rebuild/theme lifecycle, without its standalone entry spacer. */
function entryContent(
	host: unknown,
	content: PromptAttachment,
): PromptAttachment {
	return {
		[PROMPT_ATTACHMENT]: true,
		matchesPrompt: source => content.matchesPrompt(source),
		render: width =>
			renderPiComponent(host, width).slice(ENTRY_SPACING_ROWS),
		invalidate: () => {
			invokePiMethod(host, 'invalidate')
		},
	}
}

function previousPrompt(
	siblings: readonly unknown[],
	entryIndex: number,
): PromptBlock | undefined {
	for (const sibling of siblings.slice(0, entryIndex).toReversed()) {
		const children = reflectMember(sibling, 'children')
		if (!Array.isArray(children)) continue
		const prompt = children.find(child => child instanceof PromptBlock)
		if (prompt instanceof PromptBlock) return prompt
	}
	return undefined
}

/** Called only after Pi mounts an entry; unmatched/orphan content stays visible in place. */
export function mountPromptAttachments(chat: unknown, entry: unknown): void {
	const siblings = reflectMember(chat, 'children')
	if (!Array.isArray(siblings)) return
	const index = siblings.findLastIndex(
		child => reflectMember(child, 'entry') === entry,
	)
	if (index < 0) return
	const host: unknown = siblings[index]
	const content = reflectMember(host, 'customComponent')
	if (!isPromptAttachment(content)) return
	const prompt = previousPrompt(siblings, index)
	if (!prompt?.attach(entryContent(host, content))) return
	invokePiMethod(chat, 'removeChild', host)
}

export function installAttachmentSurface(component: unknown): () => void {
	return patchPiComponent(component, 'pi.raw-transcript.attachments', {
		addCustomEntryToChat(host, original, args) {
			original(...args)
			mountPromptAttachments(
				reflectMember(host, 'chatContainer'),
				args[0],
			)
		},
	})
}
