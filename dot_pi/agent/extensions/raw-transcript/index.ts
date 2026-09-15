/** raw-transcript - framed user prompts with literal source and preserved paragraphs.
 * prompt-block.ts owns presentation through the shared house frame.
 * surfaces.ts adapts user content; attachment-surface.ts nests attachment entries.
 * runtime.ts selects and version-checks Pi's live classes.
 * Assistant responses, tool rows and compaction belong exclusively to renderers/. */
import { installAttachmentSurface } from './attachment-surface.ts'
import { loadRuntimeClasses } from './runtime.ts'
import { patchUserMessages } from './surfaces.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export async function installRawTranscriptPatches(): Promise<() => void> {
	const { userMessage, interactiveMode } = await loadRuntimeClasses()
	const restoreUser = patchUserMessages(userMessage)
	try {
		const restoreAttachments = installAttachmentSurface(interactiveMode)
		return () => {
			restoreAttachments()
			restoreUser()
		}
	} catch (cause) {
		restoreUser()
		throw cause
	}
}

export default async function rawTranscript(pi: ExtensionAPI): Promise<void> {
	const dispose = await installRawTranscriptPatches()
	pi.on('session_shutdown', () => dispose())
}
