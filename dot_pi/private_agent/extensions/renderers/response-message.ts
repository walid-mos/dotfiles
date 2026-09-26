/** Decode Pi's response blocks into display-only sections; never infer finality from prose. */
import { reflectMember } from '../ui/pi-members.ts'

import type { ResponseEmphasis } from '../ui/response-divider.ts'

export interface ResponseSection {
	kind: ResponseEmphasis | 'thinking'
	text: string
}

export interface ResponseMessage {
	sections: ResponseSection[]
	hasToolCalls: boolean
	notice: { text: string; tone: 'warning' | 'danger' } | undefined
}

const TEXT_SIGNATURE_VERSION = 1
const INTERRUPTED_REASONS = new Set(['length', 'aborted', 'error'])

function textPhase(
	signature: unknown,
): 'commentary' | 'final_answer' | 'unknown' {
	if (typeof signature !== 'string' || !signature.startsWith('{'))
		return 'unknown'
	try {
		const decoded: unknown = JSON.parse(signature)
		if (
			reflectMember(decoded, 'v') !== TEXT_SIGNATURE_VERSION ||
			typeof reflectMember(decoded, 'id') !== 'string'
		)
			return 'unknown'
		const phase = reflectMember(decoded, 'phase')
		return phase === 'commentary' || phase === 'final_answer'
			? phase
			: 'unknown'
	} catch {
		// Older/foreign providers use opaque signatures; absence of a phase is not an error.
		return 'unknown'
	}
}

function sectionKind(
	block: unknown,
	fallback: ResponseEmphasis,
): ResponseSection['kind'] {
	if (reflectMember(block, 'type') === 'thinking') return 'thinking'
	const phase = textPhase(reflectMember(block, 'textSignature'))
	if (phase === 'commentary') return 'intermediate'
	if (phase === 'final_answer') return 'final'
	return fallback
}

function sectionsOf(
	blocks: readonly unknown[],
	disposition: { fallback: ResponseEmphasis; isInterrupted: boolean },
): ResponseSection[] {
	const sections: ResponseSection[] = []
	let hasThinkingBoundary = true
	for (const block of blocks) {
		const type = reflectMember(block, 'type')
		if (type !== 'thinking') hasThinkingBoundary = true
		if (type !== 'text' && type !== 'thinking') continue
		const source = reflectMember(
			block,
			type === 'text' ? 'text' : 'thinking',
		)
		if (typeof source !== 'string' || !source.trim()) continue
		const kind =
			disposition.isInterrupted && type === 'text'
				? 'intermediate'
				: sectionKind(block, disposition.fallback)
		const previous = sections.at(-1)
		if (
			previous?.kind === kind &&
			(kind !== 'thinking' || !hasThinkingBoundary)
		)
			previous.text += `\n\n${source.trim()}`
		else sections.push({ kind, text: source.trim() })
		hasThinkingBoundary = kind !== 'thinking'
	}
	return sections
}

function responseNotice(
	message: unknown,
	tools: { hasToolCalls: boolean },
): ResponseMessage['notice'] {
	const reason = reflectMember(message, 'stopReason')
	if (reason === 'length')
		return {
			text: 'Response truncated before completion.',
			tone: 'warning',
		}
	if (tools.hasToolCalls) return undefined
	const error = reflectMember(message, 'errorMessage')
	const description = typeof error === 'string' ? error.trim() : ''
	if (reason === 'error')
		return {
			text: `Error: ${description || 'Unknown error'}`,
			tone: 'danger',
		}
	if (!(reason === 'aborted'))
		return undefined
	return { text: description || 'Response interrupted.', tone: 'warning' }
}

export function readResponseMessage(
	message: unknown,
	mode: 'streaming' | 'settled',
): ResponseMessage {
	const content = reflectMember(message, 'content')
	const blocks: readonly unknown[] = Array.isArray(content) ? content : []
	const hasToolCalls = blocks.some(
		block => reflectMember(block, 'type') === 'toolCall',
	)
	const reason = reflectMember(message, 'stopReason')
	const isInterrupted =
		typeof reason === 'string' && INTERRUPTED_REASONS.has(reason)
	const fallback =
		mode === 'settled' && reason === 'stop' && !hasToolCalls
			? 'final'
			: 'intermediate'
	return {
		sections: sectionsOf(blocks, { fallback, isInterrupted }),
		hasToolCalls,
		notice: responseNotice(message, { hasToolCalls }),
	}
}
