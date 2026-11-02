import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface AuditCommand {
	arguments: string[]
	cwd: string
	environment?: NodeJS.ProcessEnv
	timeoutMs: number
}

export interface AuditExecution {
	isPassed: boolean
	exitCode: number | null
	signal: NodeJS.Signals | null
	log: string
	failure: string | undefined
}

const MAX_OUTPUT_BYTES = 4_194_304

export function runAuditProcess(
	command: AuditCommand,
	directory: string,
): AuditExecution {
	mkdirSync(directory, { recursive: true })
	const execution = spawnSync(process.execPath, command.arguments, {
		cwd: command.cwd,
		env: command.environment,
		encoding: 'utf8',
		timeout: command.timeoutMs,
		killSignal: 'SIGKILL',
		maxBuffer: MAX_OUTPUT_BYTES,
	})
	const log = join(directory, 'output.log')
	writeFileSync(log, `${execution.stdout ?? ''}${execution.stderr ?? ''}`)
	const receipt: AuditExecution = {
		isPassed: !execution.error && execution.status === 0,
		exitCode: execution.status,
		signal: execution.signal,
		log,
		failure: execution.error?.message,
	}
	writeFileSync(join(directory, 'exit.json'), JSON.stringify(receipt))
	return receipt
}
