/** Plan literal semicolon chains; preserve unsupported work and conditional chains. */
import { shellStages, validationCommand } from './shell-segments.ts'

export type ValidationCommand = NonNullable<
	ReturnType<typeof validationCommand>
>
export type ValidationStep = { source: string; validation?: ValidationCommand }
const MAX_STEPS = 16

export function validationSteps(command: string): ValidationStep[] {
	const stages = shellStages(command)
	if (!stages.some(stage => stage.after === ';')) return []
	const steps: ValidationStep[] = []
	let source = ''
	let hasDirectoryChange = false
	for (const stage of stages) {
		if (stage.words[0] === 'cd') hasDirectoryChange = true
		source += `${stage.source}${stage.after === ';' ? '' : ` ${stage.after} `}`
		if (stage.after && stage.after !== ';') continue
		const step: ValidationStep = { source: source.trim() }
		const validation = validationCommand(step.source)
		if (validation && !hasDirectoryChange) step.validation = validation
		steps.push(step)
		source = ''
	}
	if (steps.length > MAX_STEPS || !steps.some(step => step.validation))
		return []
	return steps
}
