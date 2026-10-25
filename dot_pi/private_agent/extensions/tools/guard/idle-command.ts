/**
 * A shell command whose every stage only prints a literal, assigns a variable
 * or reads the clock does no work: it stands in for a wait or a heartbeat, and
 * each call resends the whole conversation as a paid request. Refused before
 * the shell runs. Expansions, substitutions and redirections fall outside
 * shellStages, so `echo $PATH` or `echo x > file` stay allowed. Pure.
 */
import { shellStages } from './shell-segments.ts'

const IDLE_PROGRAMS = new Set(['echo', 'printf', 'true', ':', 'date'])
const ASSIGNMENT = /^[A-Za-z_]\w*=/

export const IDLE_COMMAND_REFUSAL =
	'Idle command refused: it only prints, assigns or reads the clock, so it does no work, and every tool call resends the whole conversation as a paid request. Never fill a wait with calls. A running bash job notifies this session when it completes: end this turn now, do independent work, or make one bounded `wait` on the job.'

export function isIdleCommand(command: string): boolean {
	const stages = shellStages(command)
	return (
		stages.length > 0 &&
		stages.every(stage => {
			const program = stage.words.find(word => !ASSIGNMENT.test(word))
			return !program || IDLE_PROGRAMS.has(program)
		})
	)
}
