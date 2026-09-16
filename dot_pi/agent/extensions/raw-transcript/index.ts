/** raw-transcript - framed user prompts and house-styled skill callouts.
 * prompt-block.ts owns prompt presentation; skill-block.ts the skill callout,
 * wired by skill-surface.ts; surfaces.ts adapts user content and
 * attachment-surface.ts nests attachment entries. runtime.ts selects and
 * version-checks Pi's live classes. Assistant responses, tool rows and
 * compaction belong exclusively to renderers/. */
import { installAttachmentSurface } from './attachment-surface.ts'
import { loadRuntimeClasses } from './runtime.ts'
import { patchSkillInvocations, skillToggleKey } from './skill-surface.ts'
import { patchUserMessages } from './surfaces.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export async function installRawTranscriptPatches(): Promise<() => void> {
	const { userMessage, interactiveMode, skillInvocation, keyText } =
		await loadRuntimeClasses()
	const restoreUser = patchUserMessages(userMessage)
	try {
		const restoreSkills = patchSkillInvocations(
			skillInvocation,
			skillToggleKey(keyText),
		)
		const restoreAttachments = installAttachmentSurface(interactiveMode)
		return () => {
			restoreAttachments()
			restoreSkills()
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
