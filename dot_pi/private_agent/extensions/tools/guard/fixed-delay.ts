/**
 * A `sleep` stage between other commands is a fixed delay standing in for a
 * signal, refused before the shell runs. A command that is only `sleep N` is a
 * deliberate delay, and a loop body (`while`, `until`, `for`) is a bounded
 * readiness check: both stay allowed. Quoted strings and heredoc bodies are
 * invisible to the check. Pure: no IO, no pi.
 */
const QUOTED = /'[^']*'|"(?:[^"\\]|\\.)*"/g
const HEREDOC = /<<-?\s*['"]?\w+['"]?[\s\S]*/
const LOOP_KEYWORD = /\b(?:while|until|for)\b/
const LONE_SLEEP = /^\s*sleep\s+\d+(?:\.\d+)?\s*$/
const SLEEP_STAGE = /(?:^|[;&|(]|\n)\s*(?:command\s+)?sleep\s+\d/m

export const FIXED_DELAY_REFUSAL =
	'Fixed delay refused: a `sleep` between commands waits for nothing in particular. Wait on the real signal instead: a bounded readiness check on the port, pid or file the work produces, an async subagent, or end this turn and resume on the completion notification of the bash job.'

export function isFixedDelay(command: string): boolean {
	const visible = command.replace(HEREDOC, '').replace(QUOTED, "''")
	if (LONE_SLEEP.test(visible) || LOOP_KEYWORD.test(visible)) return false
	return SLEEP_STAGE.test(visible)
}
