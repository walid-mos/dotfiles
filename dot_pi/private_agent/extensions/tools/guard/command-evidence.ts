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
import { loggedSteps } from './validation-log.ts'
import { validationSteps } from './validation-steps.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { CommandEvidence } from '#lib/command-evidence/schema.ts'
import type { RecordedStep } from './validation-log.ts'
import type { ValidationCommand } from './validation-steps.ts'

type BashDefinition = ReturnType<typeof createBashToolDefinition>
type BashArguments = Parameters<BashDefinition['execute']>
const JSON_INDENT = 2

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
	const codes = await readExitCodes(`${record.receiptPath}.codes`)
	const saved = {
		...record,
		endedAtMs: Date.now(),
		...(codes.length && {
			status: 'completed' as const,
			exitCode: codes.find(code => code !== 0) ?? 0,
		}),
		pipelineExitCodes: codes,
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

function evidenceBash(cwd: string, steps: RecordedStep[]): BashDefinition {
	const local = createLocalBashOperations()
	return createBashToolDefinition(cwd, {
		spawnHook: context => ({
			...context,
			env: { ...context.env, HERDR_ENV: undefined },
		}),
		operations: {
			exec: (_command, workingDirectory, options) =>
				local.exec(loggedSteps(steps), workingDirectory, options),
		},
	})
}

async function prepareSteps(args: BashArguments): Promise<RecordedStep[]> {
	const [, input] = args
	const single = validationCommand(input.command)
	const steps = single
		? [{ source: input.command, validation: single }]
		: validationSteps(input.command)
	return Promise.all(
		steps.map(async step => {
			if (!step.validation) return step
			const prepared = await prepareEvidence(args, step.validation)
			return Object.assign(step, prepared)
		}),
	)
}

async function saveSteps(
	steps: RecordedStep[],
	pi: ExtensionAPI,
	isCurrent: () => boolean,
): Promise<CommandEvidence[]> {
	return Promise.all(
		steps.flatMap(step =>
			step.record ? [saveEvidence(step.record, pi, isCurrent)] : [],
		),
	)
}

export async function executeWithEvidence(
	pi: ExtensionAPI,
	bash: BashDefinition,
	args: BashArguments,
	isCurrent: () => boolean,
): ReturnType<BashDefinition['execute']> {
	const [, , , , ctx] = args
	const steps = await prepareSteps(args)
	if (!steps.length) return bash.execute(...args)
	const tool = evidenceBash(ctx.cwd, steps)
	let execution: Awaited<ReturnType<BashDefinition['execute']>>
	try {
		execution = await tool.execute(...args)
	} catch (cause) {
		const saved = await saveSteps(steps, pi, isCurrent)
		throw new Error(
			`${cause instanceof Error ? cause.message : String(cause)}\n${saved.map(evidenceText).join('\n')}`,
			{ cause },
		)
	}
	const saved = await saveSteps(steps, pi, isCurrent)
	return {
		...execution,
		content: [
			...execution.content,
			{
				type: 'text',
				text: [
					...steps.map(step => step.warning),
					...saved.map(evidenceText),
				]
					.filter(Boolean)
					.join('\n'),
			},
		],
	}
}
