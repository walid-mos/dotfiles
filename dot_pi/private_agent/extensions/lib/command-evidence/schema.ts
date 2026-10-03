/** Saved validation evidence shared by the guard and checkpoints; no cached execution. */
import { Type } from 'typebox'
import { Value } from 'typebox/value'

import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import type { Static } from 'typebox'

export const COMMAND_EVIDENCE_ENTRY = 'pi-command-evidence-v1'
export const MAX_COMMAND_EVIDENCE = 32
export const commandEvidenceSchema = Type.Object({
	command: Type.String(),
	cwd: Type.String(),
	identity: Type.String(),
	workspace: Type.String(),
	startedAtMs: Type.Number(),
	endedAtMs: Type.Number(),
	status: Type.Union([
		Type.Literal('completed'),
		Type.Literal('interrupted'),
	]),
	exitCode: Type.Union([Type.Number(), Type.Null()]),
	pipelineExitCodes: Type.Array(Type.Number()),
	logPath: Type.String(),
	receiptPath: Type.String(),
})
export type CommandEvidence = Static<typeof commandEvidenceSchema>

export function commandEvidence(
	branch: readonly SessionEntry[],
): CommandEvidence[] {
	return branch
		.flatMap(entry => {
			if (
				entry.type !== 'custom' ||
				entry.customType !== COMMAND_EVIDENCE_ENTRY
			)
				return []
			return Value.Check(commandEvidenceSchema, entry.data)
				? [entry.data]
				: []
		})
		.slice(-MAX_COMMAND_EVIDENCE)
}

export function evidenceText(record: CommandEvidence): string {
	const suite = record.pipelineExitCodes[0] ?? 'unknown'
	return `${record.command}\nCwd: ${record.cwd}\nObserved ${new Date(record.endedAtMs).toISOString()}: ${record.status}; validation exit ${suite}; shell exit ${record.exitCode ?? 'unknown'}.\nFull log: ${record.logPath}\nReceipt: ${record.receiptPath}`
}
