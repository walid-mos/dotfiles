export type EvidenceBlock = {
	name: string
	sha256: string
	content: string
}

export type PacketParts = {
	checkpoint: string
	round: number
	fingerprint: string
	request: string
	ledger: string
	previousReply: string | null
	material: string
	evidence: readonly EvidenceBlock[]
	implementer: string
}

function evidenceSection(blocks: readonly EvidenceBlock[]): string {
	if (!blocks.length) return 'none recorded since the previous accepted round'
	return blocks
		.map(
			block =>
				`### ${block.name} sha256=${block.sha256}\n\n${block.content}`,
		)
		.join('\n')
}

export function renderPacket(parts: PacketParts): string {
	return [
		`checkpoint=${parts.checkpoint}`,
		`round=${parts.round}`,
		`fingerprint=${parts.fingerprint}`,
		'',
		'# Recorded by advisor.ts',
		'',
		'## Request',
		'',
		parts.request.trim(),
		'',
		'## Ledger',
		'',
		parts.ledger.trim(),
		'',
		'## Previous advisor reply',
		'',
		parts.previousReply?.trim() ?? 'none: this is the first round',
		'',
		'## Material: diff of the fingerprinted tree',
		'',
		parts.material.trim(),
		'',
		'## Evidence: recorded checks',
		'',
		evidenceSection(parts.evidence),
		'',
		'# Written by the implementer',
		'',
		parts.implementer.trim(),
		'',
	].join('\n')
}
