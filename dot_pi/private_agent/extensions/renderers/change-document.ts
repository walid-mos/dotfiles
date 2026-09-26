/** Translate Pi's numbered diff into owned code rows; Pi remains the diff engine. */
import { generateDiffString } from '@earendil-works/pi-coding-agent'

import type { ChangeDocument, ChangeLine } from '../ui/change-block.ts'

export const MAX_CHANGE_BYTES = 262_144
const DIFF_CONTEXT_LINES = 3
const MAX_DIFF_BYTES = 1_048_576
const MAX_DIFF_LINE_PRODUCT = 1_000_000
const LINE_KINDS = { '+': 'added', '-': 'removed', ' ': 'context' } as const

export function nativeChangeDocument(
	source: string,
): ChangeDocument | undefined {
	if (!source || Buffer.byteLength(source) > MAX_DIFF_BYTES) return undefined
	const lines: ChangeLine[] = []
	for (const row of source
		.replace(/\r\n/gu, '\n')
		.replace(/\n$/u, '')
		.split('\n')) {
		const parsed = nativeChangeLine(row)
		if (!parsed) return undefined
		lines.push(parsed)
	}
	return { lines, note: '' }
}

function nativeChangeLine(row: string): ChangeLine | undefined {
	const match = /^([+ -])\s*(\d+) (.*)$/u.exec(row)
	if (!match) {
		if (!/^ +\.\.\.$/u.test(row)) return undefined
		return { kind: 'gap', text: '' }
	}
	const [, prefix, number, text] = match
	const lineNumber = Number(number)
	if (
		!(prefix === '+' || prefix === '-' || prefix === ' ') ||
		!Number.isSafeInteger(lineNumber) ||
		lineNumber < 1
	)
		return undefined
	return { kind: LINE_KINDS[prefix], lineNumber, text: text ?? '' }
}

export function comparedChangeDocument(
	before: string,
	after: string,
): ChangeDocument | undefined {
	if (before === after) return { lines: [], note: 'no content changes' }
	const oldText = before.replace(/\r\n/gu, '\n')
	const newText = after.replace(/\r\n/gu, '\n')
	if (oldText === newText) return { lines: [], note: 'line endings changed' }
	if (
		oldText.split('\n').length * newText.split('\n').length >
		MAX_DIFF_LINE_PRODUCT
	)
		return writtenChangeDocument(
			after,
			'large replacement · showing written content',
		)
	const diff = generateDiffString(oldText, newText, DIFF_CONTEXT_LINES)
	return (
		nativeChangeDocument(diff.diff) ??
		writtenChangeDocument(after, 'diff unavailable')
	)
}

export function writtenChangeDocument(
	content: string,
	note = 'before snapshot unavailable',
): ChangeDocument | undefined {
	if (Buffer.byteLength(content) > MAX_CHANGE_BYTES || content.includes('\0'))
		return undefined
	const lines = content.replace(/\r\n/gu, '\n').split('\n')
	if (lines.at(-1) === '') lines.pop()
	return {
		lines: lines.map((text, index) => ({
			kind: 'written',
			text,
			lineNumber: index + 1,
		})),
		note,
	}
}
