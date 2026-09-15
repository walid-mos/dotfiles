/** Select transcript classes from the shared runtime resolver. */
import { reflectMember } from '../ui/pi-members.ts'
import { assertSupportedPi, loadPiRuntime } from '../ui/pi-runtime.ts'

export async function loadRuntimeClasses(): Promise<{
	userMessage: unknown
	interactiveMode: unknown
}> {
	const runtime = await loadPiRuntime()
	assertSupportedPi(runtime, 'raw-transcript')
	return {
		userMessage: reflectMember(runtime, 'UserMessageComponent'),
		interactiveMode: reflectMember(runtime, 'InteractiveMode'),
	}
}
