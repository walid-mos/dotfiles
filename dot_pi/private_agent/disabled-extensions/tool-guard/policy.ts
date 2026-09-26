// tool-guard policy: the composed rules, pure over a shell command string.
//
// Rule 1 (blind-wait.ts): a host-level `sleep` of ten seconds or more is a
// blind wait, and a fixed delay is a race rather than a synchronization.
//
// Rule 2 (shadowed-tools.ts): a bash stage whose work a dedicated tool owns
// (`read`, `grep`, `find`, `ls`) is refused wherever it sits - a pipe, a
// redirect or a `head`/`tail` wrapper does not change what the call is - so
// file content reaches the context through the tool that caps, renders and
// caches it.
//
// This file owns only the composition, so the enforcement surface the
// extension and the audit read never moves when a rule grows a module.
import { blindWaitReason } from './blind-wait.ts'
import { shadowedToolReason } from './shadowed-tools.ts'

/** The full policy: the first rule that fires wins. */
export function guardCommand(
	command: string,
	activeTools?: readonly string[],
): string | undefined {
	return blindWaitReason(command) ?? shadowedToolReason(command, activeTools)
}
