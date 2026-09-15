/** Decode untrusted streamed/replayed tool payloads once at the presentation boundary. */
import { stripVTControlCharacters } from 'node:util'

import { reflectMember } from '../ui/pi-members.ts'

export function payloadText(host: unknown, key: string): string {
	const field = reflectMember(host, key)
	return typeof field === 'string' ? field : ''
}

export function payloadNumber(host: unknown, key: string): number | undefined {
	const field = reflectMember(host, key)
	if (typeof field !== 'number' || !Number.isFinite(field)) return undefined
	return field
}

export function singleLine(source: string): string {
	return stripVTControlCharacters(source).replace(/\s+/gu, ' ').trim()
}

export interface ToolOutput {
	text: string
	details: unknown
	imageCount: number
	isError: boolean
}

export function toolOutput(toolResult: unknown): ToolOutput | undefined {
	if (!toolResult) return undefined
	const content = reflectMember(toolResult, 'content')
	const blocks: unknown[] = Array.isArray(content) ? content : []
	return {
		text: blocks
			.filter(block => payloadText(block, 'type') === 'text')
			.map(block => payloadText(block, 'text'))
			.join('\n'),
		details: reflectMember(toolResult, 'details'),
		imageCount: blocks.filter(
			block => payloadText(block, 'type') === 'image',
		).length,
		isError: reflectMember(toolResult, 'isError') === true,
	}
}

export function outputLineCount(text: string): number {
	return text.trimEnd() ? text.trimEnd().split('\n').length : 0
}

const COUNT_UNITS = { line: 'l', image: 'img', file: 'f' } as const

export function count(noun: keyof typeof COUNT_UNITS, total: number): string {
	return `${String(total)}${COUNT_UNITS[noun]}`
}

/** Observed output size for a row: attached images win over lines of text. */
export function countLines(output: ToolOutput): string {
	if (output.imageCount) return count('image', output.imageCount)
	const truncation = reflectMember(output.details, 'truncation')
	return count(
		'line',
		payloadNumber(truncation, 'outputLines') ??
			outputLineCount(output.text),
	)
}
