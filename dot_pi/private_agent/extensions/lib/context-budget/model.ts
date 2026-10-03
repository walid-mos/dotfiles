import { randomUUID } from 'node:crypto'
import {
	chmodSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { getAgentDir } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

import type { Static } from 'typebox'

const MODEL_REFERENCE = /^[^/]+\/.+$/
const MAX_WINDOW_SHARE = 0.5
const MAX_RECENT_SHARE = 0.25
export const CHECKPOINT_INDENT = '\t'
const positiveTokens = Type.Integer({
	minimum: 1,
	maximum: Number.MAX_SAFE_INTEGER,
})
const settingsSchema = Type.Object(
	{
		summaryModel: Type.String({ pattern: MODEL_REFERENCE.source }),
		maxContextTokens: positiveTokens,
		keepRecentTokens: positiveTokens,
	},
	{ additionalProperties: true },
)
export type CheckpointSettings = Static<typeof settingsSchema>

export function checkpointModelPath(): string {
	return join(getAgentDir(), 'context-budget.json')
}

export function minimumCheckpointCeiling(keepRecentTokens: number): number {
	return Math.floor(keepRecentTokens / MAX_WINDOW_SHARE) + 1
}

export function validateCheckpointSettings(
	candidate: unknown,
): CheckpointSettings {
	if (!Value.Check(settingsSchema, candidate))
		throw new Error(
			'context-budget.json requires summaryModel and positive integer maxContextTokens/keepRecentTokens.',
		)
	if (
		candidate.maxContextTokens <
		minimumCheckpointCeiling(candidate.keepRecentTokens)
	)
		throw new Error(
			'Context Budget requires maxContextTokens > 2 × keepRecentTokens.',
		)
	return candidate
}

export function checkpointSettingsVersion(): string {
	try {
		const { dev, ino, size, mtimeNs, ctimeNs } = statSync(
			checkpointModelPath(),
			{ bigint: true },
		)
		return `${dev}:${ino}:${size}:${mtimeNs}:${ctimeNs}`
	} catch {
		return 'unavailable'
	}
}

export function readCheckpointSettings(): CheckpointSettings {
	return validateCheckpointSettings(
		JSON.parse(readFileSync(checkpointModelPath(), 'utf8')),
	)
}

export function checkpointWindowCap(
	contextWindow = Number.POSITIVE_INFINITY,
): number {
	return Math.floor(contextWindow * MAX_WINDOW_SHARE)
}

export function readCheckpointBudget(
	contextWindow = Number.POSITIVE_INFINITY,
): { maxContextTokens: number; keepRecentTokens: number } {
	const settings = readCheckpointSettings()
	const ceiling = Math.min(
		settings.maxContextTokens,
		checkpointWindowCap(contextWindow),
	)
	return {
		maxContextTokens: ceiling,
		keepRecentTokens: Math.min(
			settings.keepRecentTokens,
			Math.floor(ceiling * MAX_RECENT_SHARE),
		),
	}
}

export function readCheckpointModel(): string | undefined {
	try {
		return readCheckpointSettings().summaryModel
	} catch {
		// The picker can show an unset model; checkpoint execution refuses it.
		return undefined
	}
}

export function writeCheckpointModel(reference: string): boolean {
	const settings = readCheckpointSettings()
	if (settings.summaryModel === reference) return false
	const next = validateCheckpointSettings({
		...settings,
		summaryModel: reference,
	})
	const path = checkpointModelPath()
	const temporary = `${path}.${randomUUID()}.tmp`
	try {
		const { mode } = statSync(path)
		writeFileSync(
			temporary,
			`${JSON.stringify(next, null, CHECKPOINT_INDENT)}\n`,
			{ mode, flag: 'wx' },
		)
		chmodSync(temporary, mode)
		renameSync(temporary, path)
	} catch (error) {
		rmSync(temporary, { force: true })
		throw error
	}
	return true
}
