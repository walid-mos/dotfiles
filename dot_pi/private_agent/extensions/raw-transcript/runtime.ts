/** Select transcript classes from the shared runtime resolver. */
import { reflectMember } from '../ui/pi-members.ts'
import { assertSupportedPi, loadPiRuntime } from '../ui/pi-runtime.ts'

export interface RawTranscriptRuntime {
	userMessage: unknown
	interactiveMode: unknown
	skillInvocation: unknown
	keyText: unknown
}

export async function loadRuntimeClasses(): Promise<RawTranscriptRuntime> {
	const runtime = await loadPiRuntime()
	assertSupportedPi(runtime, 'raw-transcript')
	return {
		userMessage: reflectMember(runtime, 'UserMessageComponent'),
		interactiveMode: reflectMember(runtime, 'InteractiveMode'),
		skillInvocation: reflectMember(
			runtime,
			'SkillInvocationMessageComponent',
		),
		keyText: reflectMember(runtime, 'keyText'),
	}
}
