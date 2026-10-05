// Branch-persistent visual evidence. Names and compaction never reset receipts.
import { createHash } from 'node:crypto'

import { Type } from 'typebox'
import { Value } from 'typebox/value'

import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import type { Static } from 'typebox'
import type { PixelPair } from './pixel-diff.ts'

export const PIXEL_PROGRESS_ENTRY = 'frontend-pixel-progress-v1'
const MAX_QUOTE_CHARS = 2000

export const pixelProbeSchema = Type.Object({
	hypothesis: Type.String({ minLength: 1, maxLength: 800 }),
	expected_effect: Type.String({ minLength: 1, maxLength: 800 }),
	evidence_entry: Type.Optional(
		Type.String({ minLength: 1, maxLength: 120 }),
	),
	evidence_quote: Type.Optional(
		Type.String({ minLength: 1, maxLength: MAX_QUOTE_CHARS }),
	),
})
export type PixelProbe = Static<typeof pixelProbeSchema>

const receiptSchema = Type.Object({
	surface: Type.String(),
	pair: Type.String(),
	mode: Type.Union([Type.Literal('compared'), Type.Literal('held')]),
	report: Type.String(),
	probe: Type.Optional(pixelProbeSchema),
	probeKey: Type.Optional(Type.String()),
	evidenceHash: Type.Optional(Type.String()),
	decision: Type.Optional(Type.String()),
})
export type PixelReceipt = Static<typeof receiptSchema>
export type PixelJournal = {
	entries: () => readonly SessionEntry[]
	append: (receipt: PixelReceipt) => void
}

export function pixelHash(contents: string | Buffer): string {
	return createHash('sha256').update(contents).digest('hex')
}

export function pixelIdentity(pair: PixelPair): {
	surface: string
	pair: string
} {
	const surfaces = [pair.a, pair.b].map(capture => {
		const url = new URL(capture.url)
		return {
			url: `${url.origin}${url.pathname}`,
			selector: capture.selector,
		}
	})
	const captures = [pair.a, pair.b].map(({ png, ...metadata }) =>
		Object.assign(metadata, { png: pixelHash(png) }),
	)
	return {
		surface: pixelHash(JSON.stringify(surfaces)),
		pair: pixelHash(JSON.stringify(captures)),
	}
}

export function pixelReceipts(
	entries: readonly SessionEntry[],
): PixelReceipt[] {
	return entries.flatMap(entry => {
		if (
			entry.type !== 'custom' ||
			entry.customType !== PIXEL_PROGRESS_ENTRY
		)
			return []
		if (!Value.Check(receiptSchema, entry.data))
			throw new Error(
				'Invalid visual progress receipt; preserve it and resolve the session evidence before retrying.',
			)
		return [entry.data]
	})
}

const EVIDENCE_TOOLS = new Set([
	'frontend_eval',
	'frontend_iso_diff',
	'frontend_check_spec',
	'read',
	'edit',
	'write',
])

function diagnosticText(entry: SessionEntry): string | undefined {
	if (entry.type !== 'message' || entry.message.role !== 'toolResult')
		return undefined
	const { message } = entry
	if (message.isError || !EVIDENCE_TOOLS.has(message.toolName))
		return undefined
	return message.content
		.filter(block => block.type === 'text')
		.map(block => block.text)
		.join('\n')
}

/** Exact citations only; a new name, timestamp or capture is not new reasoning. */
export function pixelProbeEvidence(
	entries: readonly SessionEntry[],
	probe: PixelProbe,
): { tool: string; quote: string; hash: string; key: string } {
	const entry = entries.findLast(candidate =>
		probe.evidence_entry
			? candidate.id === probe.evidence_entry ||
				(candidate.type === 'message' &&
					candidate.message.role === 'toolResult' &&
					candidate.message.toolCallId === probe.evidence_entry)
			: !!probe.evidence_quote &&
				!!diagnosticText(candidate)?.includes(probe.evidence_quote),
	)
	if (entry?.type !== 'message' || entry.message.role !== 'toolResult')
		throw new Error(
			'Cite an exact excerpt from a recorded diagnostic/source result on this branch; evidence_entry is optional.',
		)
	const { message } = entry
	if (message.isError || !EVIDENCE_TOOLS.has(message.toolName))
		throw new Error(
			'Cite a successful DOM/style diagnostic or source read/edit, not a capture, diff, error or assistant claim.',
		)
	const text = message.content
		.filter(block => block.type === 'text')
		.map(block => block.text)
		.join('\n')
		.replace(/\nEvidence reference: [^\n]+$/, '')
	const quote = probe.evidence_quote ?? text.trim()
	if (!quote.trim() || !text.includes(quote))
		throw new Error(
			'probe.evidence_quote must be an exact nonempty excerpt of the cited result.',
		)
	if (quote.length > MAX_QUOTE_CHARS)
		throw new Error(
			'Cited result is too large. Return a focused frontend_eval observation or supply an exact evidence_quote of at most 2000 characters.',
		)
	const hash = pixelHash(`${message.toolName}\n${text.trim()}`)
	const key = pixelHash(
		JSON.stringify([
			hash,
			probe.hypothesis.trim(),
			probe.expected_effect.trim(),
		]),
	)
	return { tool: message.toolName, quote, hash, key }
}
