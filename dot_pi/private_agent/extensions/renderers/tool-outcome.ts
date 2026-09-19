/** Interpret terminal status, never incidental words/counters in a command's output. */
import { singleLine } from './tool-payload.ts'

import type { ToolOutput } from './tool-payload.ts'

function terminalStatus(output: ToolOutput): string {
	return singleLine(output.text.trimEnd().split('\n').at(-1) ?? '')
}

export function isCancelledOutput(output: ToolOutput | undefined): boolean {
	if (!output?.isError) return false
	return /^(?:(?:Command|Operation|Tool execution(?: was)?) )?(?:aborted|cancelled|canceled)\.?$/iu.test(
		terminalStatus(output),
	)
}

export function failureSummary(output: ToolOutput): string {
	const exit = /(?:exited (?:with )?code|exit code:)\s*(\d+)\s*$/iu.exec(
		terminalStatus(output),
	)
	if (exit) return `exit ${exit[1]}`
	return (
		singleLine(output.text.split('\n').find(line => line.trim()) ?? '') ||
		'failed'
	)
}
