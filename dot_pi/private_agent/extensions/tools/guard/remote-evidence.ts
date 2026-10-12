import { writeFile } from 'node:fs/promises'
/**
 * Validation evidence for a command that runs on a workspace Boat: the logged
 * command writes into a Boat temp directory, and the log and exit codes are
 * copied back to the local evidence paths once the command ends.
 */
import { basename, dirname, join } from 'node:path'

import { quote } from '#lib/runtime/remote.ts'

import { loggedSteps } from './validation-log.ts'

import type { ExecOptions } from '#lib/runtime/remote.ts'
import type { Runtime } from '#lib/runtime/runtime.ts'
import type { RecordedStep } from './validation-log.ts'

const REMOTE_EVIDENCE_ROOT = '/tmp/pi-evidence'
const CODES_SUFFIX = '.codes'

type EvidencePair = { readonly local: string; readonly remote: string }

export async function execRemoteEvidence(
	runtime: Runtime,
	steps: RecordedStep[],
	cwd: string,
	options: ExecOptions,
): Promise<{ exitCode: number | null }> {
	const remoteSteps = steps.map(remoteStep)
	const directories = [
		...new Set(
			remoteSteps.flatMap(step =>
				step.record ? [dirname(step.record.logPath)] : [],
			),
		),
	]
	const prepare = `mkdir -p ${directories.map(quote).join(' ')}`
	try {
		return await runtime.exec(
			`${prepare}\n${loggedSteps(remoteSteps)}`,
			cwd,
			options,
		)
	} finally {
		await Promise.all(
			evidencePairs(steps, remoteSteps).map(pair => pull(runtime, pair)),
		)
	}
}

function remoteStep(step: RecordedStep): RecordedStep {
	if (!step.record) return step
	const directory = join(
		REMOTE_EVIDENCE_ROOT,
		basename(dirname(step.record.logPath)),
	)
	return {
		...step,
		record: {
			...step.record,
			logPath: join(directory, basename(step.record.logPath)),
			receiptPath: join(directory, basename(step.record.receiptPath)),
		},
	}
}

function evidencePairs(
	steps: RecordedStep[],
	remoteSteps: RecordedStep[],
): EvidencePair[] {
	return steps.flatMap((step, index) => {
		const remote = remoteSteps[index]?.record
		if (!step.record || !remote) return []
		return [
			{ local: step.record.logPath, remote: remote.logPath },
			{
				local: `${step.record.receiptPath}${CODES_SUFFIX}`,
				remote: `${remote.receiptPath}${CODES_SUFFIX}`,
			},
		]
	})
}

/** A missing remote file (timeout, cancellation) leaves the local one as it was. */
async function pull(runtime: Runtime, pair: EvidencePair): Promise<void> {
	try {
		await writeFile(pair.local, await runtime.readFile(pair.remote), {
			mode: 0o600,
		})
	} catch {
		return undefined
	}
}
