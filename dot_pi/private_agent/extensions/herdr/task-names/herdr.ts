/** All Herdr operations use its public CLI and an explicit socket or pane ID. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { Value } from 'typebox/value'

import { SnapshotResponse, SOURCE } from './contracts.ts'

import type { PaneTask, Snapshot } from './contracts.ts'

const exec = promisify(execFile)
const CLI_TIMEOUT_MS = 5_000
const CLI_BUFFER_BYTES = 8_388_608

export async function herdr(args: string[]): Promise<unknown> {
	try {
		const command = await exec(
			process.env.HERDR_BIN_PATH || 'herdr',
			args,
			{
				timeout: CLI_TIMEOUT_MS,
				maxBuffer: CLI_BUFFER_BYTES,
			},
		)
		if (!command.stdout.trim()) return undefined
		return JSON.parse(command.stdout)
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : String(cause)
		throw new Error(`Herdr ${args[0]} ${args[1]} failed: ${message}`, {
			cause,
		})
	}
}

export async function snapshot(): Promise<Snapshot> {
	const response = await herdr(['api', 'snapshot'])
	if (!Value.Check(SnapshotResponse, response))
		throw new Error('Herdr returned an invalid session snapshot')
	return response.result.snapshot
}

export const renameTab = (id: string, title: string): Promise<unknown> =>
	herdr(['tab', 'rename', id, title])
export async function publishTask(
	task: PaneTask,
	title: string,
): Promise<void> {
	// The elected writer serializes refreshes. A process-start sequence would
	// reject reports when an older Pi process takes over from a newer one.
	await herdr([
		'pane',
		'report-metadata',
		task.id,
		'--source',
		SOURCE,
		'--agent',
		'pi',
		'--token',
		`task=${title}`,
		'--token',
		`project=${task.project}`,
	])
}
