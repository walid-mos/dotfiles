/** prompt-surfaces.ts composes the user-side display patches: framed prompts
 * (prompt-block.ts), skill callouts (skill-block.ts, mounted by
 * skill-surface.ts), adapted user content (surfaces.ts) and nested attachment
 * entries (attachment-surface.ts). runtime.ts selects and version-checks Pi's
 * live classes. */
import { installAttachmentSurface } from './attachment-surface.ts'
import { loadRuntimeClasses } from './runtime.ts'
import { patchSkillInvocations, skillToggleKey } from './skill-surface.ts'
import { patchUserMessages } from './surfaces.ts'

/** Install every user-side display patch; returns the combined restore. */
export async function installPromptSurfaces(): Promise<() => void> {
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
