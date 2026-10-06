/** Save each named validation before filtering, without changing arbitrary shell policy. */
import type { CommandEvidence } from '#lib/command-evidence/schema.ts'
import type { ValidationCommand, ValidationStep } from './validation-steps.ts'

export type RecordedStep = ValidationStep & {
	record?: CommandEvidence
	warning?: string
}

function shellQuote(path: string): string {
	return `'${path.replaceAll("'", "'\\''")}'`
}

export function loggedValidation(
	command: ValidationCommand,
	record: CommandEvidence,
): string {
	const log = shellQuote(record.logPath)
	const codes = shellQuote(`${record.receiptPath}.codes`)
	if (!command.filters.length)
		return `set -o pipefail\n( ${command.base} ) 2>&1 | tee ${log}\n__pi_exit=$? __pi_codes=("\${PIPESTATUS[@]}")\nprintf '%s\\n' "\${__pi_codes[@]}" > ${codes}\nexit "$__pi_exit"`
	// Filtering the saved file after completion prevents head/SIGPIPE from truncating the suite.
	const filters = command.filters.map(stage => ` | ${stage.source}`).join('')
	return `( ${command.base} ) > ${log} 2>&1\n__pi_validation=$?\ncat ${log}${filters}\n__pi_display=$?\nprintf '%s\\n' "$__pi_validation" "$__pi_display" > ${codes}\nif [ "$__pi_validation" -ne 0 ]; then exit "$__pi_validation"; fi\nexit "$__pi_display"`
}

function loggedStep(step: RecordedStep): string {
	if (!step.validation || !step.record) return `${step.source}\n__pi_last=$?`
	return `( ${loggedValidation(step.validation, step.record)} )\n__pi_last=$?\nif [ "$__pi_last" -ne 0 ] && [ "$__pi_first_failure" -eq 0 ]; then __pi_first_failure=$__pi_last; fi`
}

export function loggedSteps(steps: RecordedStep[]): string {
	const [single] = steps
	if (steps.length === 1 && single?.validation && single.record)
		return loggedValidation(single.validation, single.record)
	return `__pi_first_failure=0\n${steps.map(loggedStep).join('\n')}\nif [ "$__pi_first_failure" -ne 0 ]; then exit "$__pi_first_failure"; fi\nexit "$__pi_last"`
}
