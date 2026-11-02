import { Type } from 'typebox'
import { Value } from 'typebox/value'

export interface PackageAuditContext {
	hostRoot: string
	temporaryDirectory: string
}

const evidenceSchema = Type.Array(
	Type.String({ minLength: 1, pattern: '\\S' }),
	{ minItems: 1 },
)

export function auditEvidence(evidence: unknown): string[] {
	if (!Value.Check(evidenceSchema, evidence))
		throw new Error(
			'Package audit must return non-empty runtime evidence strings',
		)
	return evidence
}
