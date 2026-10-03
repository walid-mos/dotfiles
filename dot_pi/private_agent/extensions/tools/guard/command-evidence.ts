import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** Save validation output before display filters; repeats warn and still execute. */
import {
	createBashToolDefinition,
	createLocalBashOperations,
} from '@earendil-works/pi-coding-agent'

import {
	COMMAND_EVIDENCE_ENTRY,
	commandEvidence,
	evidenceText,
} from '#lib/command-evidence/schema.ts'

import { commandWorkspace } from './command-workspace.ts'
import { validationCommand } from './shell-segments.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { CommandEvidence } from '#lib/command-evidence/schema.ts'

type BashDefinition = ReturnType<typeof createBashToolDefinition>
type BashArguments = Parameters<BashDefinition['execute']>
type ValidationCommand = NonNullable<ReturnType<typeof validationCommand>>
const JSON_INDENT = 2

function shellQuote(path: string): string {
	return `'${path.replaceAll("'", "'\\''")}'`
}

function loggedCommand(
	command: ValidationCommand,
	record: CommandEvidence,
): string {
	const log = shellQuote(record.logPath)
	const codes = shellQuote(`${record.receiptPath}.codes`)
	if (!command.filters.length)
		return `set -o pipefail\n( ${command.base} ) 2>&1 | tee ${log}\n__pi_exit=$? __pi_codes=("\${PIPESTATUS[@]}")\nprintf '%s\\n' "\${__pi_codes[@]}" > ${codes}\nexit "$__pi_exit"`
	// Filtering the saved file only after completion prevents head/SIGPIPE from truncating the suite.
	const filters = command.filters.map(stage => ` | ${stage.source}`).join('')
	return `( ${command.base} ) > ${log} 2>&1\n__pi_validation=$?\ncat ${log}${filters}\n__pi_display=$?\nprintf '%s\\n' "$__pi_validation" "$__pi_display" > ${codes}\nif [ "$__pi_validation" -ne 0 ]; then exit "$__pi_validation"; fi\nexit "$__pi_display"`
}

async function readExitCodes(path: string): Promise<number[]> {
	try {
		const codes = await readFile(path, 'utf8')
		return codes
			.trim()
			.split('\n')
			.filter(code => /^\d+$/.test(code))
			.map(Number)
	} catch (cause) {
		if (
			!(
				cause instanceof Error &&
				'code' in cause &&
				cause.code === 'ENOENT'
			)
		)
			throw cause
		return [] // Timeout/cancellation has no known upstream status.
	}
}

async function saveEvidence(
	record: CommandEvidence,
	pi: ExtensionAPI,
	isCurrent: () => boolean,
): Promise<CommandEvidence> {
	const saved = {
		...record,
		endedAtMs: Date.now(),
		pipelineExitCodes: await readExitCodes(`${record.receiptPath}.codes`),
	}
	await writeFile(
		saved.receiptPath,
		JSON.stringify(saved, null, JSON_INDENT),
		{ mode: 0o600 },
	)
	if (isCurrent()) pi.appendEntry(COMMAND_EVIDENCE_ENTRY, saved)
	return saved
}

async function prepareEvidence(
	args: BashArguments,
	command: ValidationCommand,
): Promise<{ record: CommandEvidence; warning: string }> {
	const [, , , update, ctx] = args
	const cwd = resolve(ctx.cwd, command.directory)
	const workspace = await commandWorkspace(cwd)
	const previous = commandEvidence(ctx.sessionManager.getBranch()).findLast(
		record =>
			workspace &&
			record.workspace === workspace &&
			record.identity === command.identity,
	)
	const warning = previous
		? `Repeated validation with the same observed Git state. Prior validation exit ${previous.pipelineExitCodes[0] ?? 'unknown'}; log ${previous.logPath}. External/ignored inputs are not verified. This run still executes; inspect saved output instead when only its presentation needs changing.`
		: ''
	if (warning) {
		ctx.ui.notify(warning, 'warning')
		update?.({
			content: [{ type: 'text', text: warning }],
			details: undefined,
		})
	}
	const directory = await mkdtemp(join(tmpdir(), 'pi-command-'))
	const logPath = join(directory, 'output.log')
	await writeFile(logPath, '', { mode: 0o600 })
	return {
		warning,
		record: {
			command: command.base,
			cwd,
			identity: command.identity,
			workspace,
			startedAtMs: Date.now(),
			endedAtMs: Date.now(),
			status: 'interrupted',
			exitCode: null,
			pipelineExitCodes: [],
			logPath,
			receiptPath: join(directory, 'receipt.json'),
		},
	}
}

function evidenceBash(
	cwd: string,
	command: ValidationCommand,
	record: CommandEvidence,
): {
	tool: BashDefinition
	observation: Pick<CommandEvidence, 'status' | 'exitCode'>
} {
	const local = createLocalBashOperations()
	const observation: Pick<CommandEvidence, 'status' | 'exitCode'> = {
		status: 'interrupted',
		exitCode: null,
	}
	const tool = createBashToolDefinition(cwd, {
		spawnHook: context => ({
			...context,
			env: { ...context.env, HERDR_ENV: undefined },
		}),
		operations: {
			exec: async (_command, workingDirectory, options) => {
				const execution = await local.exec(
					loggedCommand(command, record),
					workingDirectory,
					options,
				)
				observation.exitCode = execution.exitCode
				observation.status = 'completed'
				return execution
			},
		},
	})
	return { tool, observation }
}

export async function executeWithEvidence(
	pi: ExtensionAPI,
	bash: BashDefinition,
	args: BashArguments,
	isCurrent: () => boolean,
): ReturnType<BashDefinition['execute']> {
	const [, input, , , ctx] = args
	const command = validationCommand(input.command)
	if (!command) return bash.execute(...args)
	const { record, warning } = await prepareEvidence(args, command)
	const { tool, observation } = evidenceBash(ctx.cwd, command, record)
	let execution: Awaited<ReturnType<BashDefinition['execute']>>
	try {
		execution = await tool.execute(...args)
	} catch (cause) {
		const saved = await saveEvidence(
			{ ...record, ...observation },
			pi,
			isCurrent,
		)
		throw new Error(
			`${cause instanceof Error ? cause.message : String(cause)}\n${evidenceText(saved)}`,
			{ cause },
		)
	}
	const saved = await saveEvidence(
		{ ...record, ...observation },
		pi,
		isCurrent,
	)
	return {
		...execution,
		content: [
			...execution.content,
			{
				type: 'text',
				text: [warning, evidenceText(saved)].filter(Boolean).join('\n'),
			},
		],
	}
}
