/** A validation issued from inside a codemode script: a non-zero exit rejects `tools.bash()` and
 * aborts the remaining steps, so the batch has to finish before the check runs. Pure: no IO, no pi. */
import { namesValidation } from './shell-segments.ts'

export const SCRIPT_VALIDATION_REFUSAL =
	'Validation does not run inside a codemode script: a non-zero exit rejects tools.bash() and aborts every later step, keeping the edits already made. Finish the batch, then run this command as a direct bash call without redirecting its output; the guard saves its complete log and exit codes.'

/** The refusal for a shell call a script issued (parentToolCallId set) that names a validation task. */
export function scriptValidationRefusal(
	command: string,
	isNested: boolean,
): string | undefined {
	if (!isNested || !namesValidation(command)) return undefined
	return SCRIPT_VALIDATION_REFUSAL
}
