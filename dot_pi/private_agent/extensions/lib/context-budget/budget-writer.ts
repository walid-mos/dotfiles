/** Queue budget saves; prepare bytes asynchronously, then check and commit without yielding. */
import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync } from 'node:fs'
import { chmod, readFile, rm, stat, writeFile } from 'node:fs/promises'

import { withFileMutationQueue } from '@earendil-works/pi-coding-agent'

import {
	CHECKPOINT_INDENT,
	checkpointModelPath,
	validateCheckpointSettings,
} from './model.ts'

async function saveBudget(maxContextTokens: number): Promise<void> {
	const path = checkpointModelPath()
	const text = await readFile(path, 'utf8')
	const settings = validateCheckpointSettings(JSON.parse(text))
	const next = validateCheckpointSettings({ ...settings, maxContextTokens })
	if (settings.maxContextTokens === maxContextTokens) return
	const temporary = `${path}.${randomUUID()}.tmp`
	try {
		const { mode } = await stat(path)
		await writeFile(
			temporary,
			`${JSON.stringify(next, null, CHECKPOINT_INDENT)}\n`,
			{ mode, flag: 'wx' },
		)
		await chmod(temporary, mode)
		// /models saves synchronously. These two small synchronous operations leave
		// no JS yield where that writer could land after our check but before commit.
		if (readFileSync(path, 'utf8') !== text)
			throw new Error(
				'context-budget.json changed while saving; reopen /context-budget to retry.',
			)
		renameSync(temporary, path)
	} catch (error) {
		await rm(temporary, { force: true })
		throw error
	}
}

export function writeCheckpointBudget(maxContextTokens: number): Promise<void> {
	return withFileMutationQueue(checkpointModelPath(), () =>
		saveBudget(maxContextTokens),
	)
}
