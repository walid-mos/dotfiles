/** Prompt-text scanning side of captures: shell words, spaces-tolerant spans. */

import { looksLikePath, readImageCapture } from './image-paths.ts'

import type { PromptCapture } from './image-paths.ts'

/** Unquoted shell word: double/single quoted strings or escaped bare words. */
const SHELL_WORD = /"(?:\\.|[^"\\])*"|'[^']*'|(?:\\.|[^\s])+/gu

/** +1 token per extra path fragment; a merge stops after this many words. */
const MAX_MERGED_TOKENS = 12

/** One capture found in the prompt text, plus the raw span it came from. */
export type CaptureSpan = {
	readonly capture: PromptCapture
	readonly start: number
	readonly end: number
	readonly replacement: string
}

/** The rewritten prompt text plus captures in alias order. */
export type ScannedImageCaptures = {
	readonly rewritten: string
	readonly captures: readonly PromptCapture[]
}

/** Everything the scanner reads; immutable for the duration of one scan. */
type ScanContext = {
	readonly matches: RegExpMatchArray[]
	readonly text: string
	readonly cwd: string
}

/**
 * Replace image paths in prompt text with `[img:N]` aliases and collect the
 * captures. Quoted paths stay single shell-word tokens; unquoted paths with
 * spaces (macOS screenshot names) resolve by joining consecutive tokens, and
 * merging needs each joined word to decode 1:1 (no quotes or escapes) so the
 * raw text slice is already the candidate path.
 */
export function scanImageCaptures(
	text: string,
	cwd: string,
	firstNumber: number,
): ScannedImageCaptures {
	const context: ScanContext = {
		matches: [...text.matchAll(SHELL_WORD)],
		text,
		cwd,
	}
	const spans: CaptureSpan[] = []
	let aliasNumber = firstNumber
	let index = 0
	while (index < context.matches.length) {
		const step = ingestAtToken(context, index, aliasNumber)
		if (!step) {
			index += 1
			continue
		}
		spans.push(step.span)
		aliasNumber += 1
		index += step.consumed
	}
	if (!spans.length) return { rewritten: text, captures: [] }
	const captures = spans.map(span => span.capture)
	return { rewritten: assemble(text, spans), captures }
}

/** Splice every span's replacement in while keeping untouched text as-is. */
function assemble(text: string, spans: readonly CaptureSpan[]): string {
	let cursor = 0
	let rewritten = ''
	for (const span of spans) {
		rewritten += `${text.slice(cursor, span.start)}${span.replacement}`
		cursor = span.end
	}
	return rewritten + text.slice(cursor)
}

type IngestStep = {
	readonly span: CaptureSpan
	readonly consumed: number
}

/** Single token first (quoted paths, punctuation); merges only as fallback. */
function ingestAtToken(
	context: ScanContext,
	index: number,
	aliasNumber: number,
): IngestStep | undefined {
	const single = singleTokenSpan(context, index, aliasNumber)
	if (single) return { span: single, consumed: 1 }
	return mergedStep(context, index, aliasNumber)
}

/** The single-token semantics: quoted paths, inner starts, punct trimming. */
function singleTokenSpan(
	context: ScanContext,
	index: number,
	aliasNumber: number,
): CaptureSpan | undefined {
	const match = context.matches[index]
	if (!match) return undefined
	const [word = ''] = match
	const candidates: SingleTokenCandidates = {
		context,
		decoded: decodeShellWord(word),
		aliasNumber,
		tokenStart: match.index ?? 0,
		tokenEnd: (match.index ?? 0) + word.length,
	}
	return firstCandidateSpan(candidates)
}

type SingleTokenCandidates = {
	readonly context: ScanContext
	readonly decoded: string
	readonly aliasNumber: number
	readonly tokenStart: number
	readonly tokenEnd: number
}

/** Tries every path start/end window the decoded token offers. */
function firstCandidateSpan(
	candidates: SingleTokenCandidates,
): CaptureSpan | undefined {
	for (const start of pathStartIndexes(candidates.decoded)) {
		const span = candidateSpanAt(candidates, start)
		if (span) return span
	}
	return undefined
}

function candidateSpanAt(
	candidates: SingleTokenCandidates,
	start: number,
): CaptureSpan | undefined {
	for (const end of pathEndIndexes(candidates.decoded, start)) {
		const capture = readImageCapture(
			candidates.decoded.slice(start, end),
			candidates.context.cwd,
			candidates.aliasNumber,
		)
		if (!capture) continue
		return {
			capture,
			start: candidates.tokenStart,
			end: candidates.tokenEnd,
			replacement: `${candidates.decoded.slice(0, start)}${capture.alias}${candidates.decoded.slice(end)}`,
		}
	}
	return undefined
}

/**
 * Join consecutive mergeable words into one path candidate that statSync
 * validates. Merging only starts inside a token that looks path-like.
 */
function mergedStep(
	context: ScanContext,
	index: number,
	aliasNumber: number,
): IngestStep | undefined {
	const starter = context.matches[index]
	if (!starter || !isMergeableWord(starter)) return undefined
	for (const start of pathStartIndexes(starter[0] ?? '')) {
		const step = mergedFromStart(
			context,
			index,
			aliasNumber,
			(starter.index ?? 0) + start,
		)
		if (step) return step
	}
	return undefined
}

/** Grows the span word by word while the words stay composable. */
function mergedFromStart(
	context: ScanContext,
	first: number,
	aliasNumber: number,
	spanStart: number,
): IngestStep | undefined {
	const mergeLast = Math.min(
		first + MAX_MERGED_TOKENS - 1,
		context.matches.length - 1,
	)
	for (let last = first + 1; last <= mergeLast; last += 1) {
		const word = context.matches[last]
		if (!word || !isMergeableWord(word)) break
		const step = stepAtLast(
			context,
			{ first, spanStart },
			last,
			aliasNumber,
		)
		if (step) return step
	}
	return undefined
}

/** Closes the span inside the last word: full word first, then punct trims. */
function stepAtLast(
	context: ScanContext,
	plan: { readonly first: number; readonly spanStart: number },
	last: number,
	aliasNumber: number,
): IngestStep | undefined {
	const match = context.matches[last]
	if (!match) return undefined
	const [word = ''] = match
	for (const spanEnd of endVariants(word, match.index ?? 0)) {
		const capture = captureAtEnd(
			context,
			plan.spanStart,
			spanEnd,
			aliasNumber,
		)
		if (!capture) continue
		return {
			span: {
				capture,
				start: plan.spanStart,
				end: spanEnd,
				replacement: capture.alias,
			},
			consumed: last - plan.first + 1,
		}
	}
	return undefined
}

/** Reads the raw slice as a path; undefined when it is no image file. */
function captureAtEnd(
	context: ScanContext,
	spanStart: number,
	spanEnd: number,
	aliasNumber: number,
): PromptCapture | undefined {
	return readImageCapture(
		context.text.slice(spanStart, spanEnd),
		context.cwd,
		aliasNumber,
	)
}

/** Ends inside the last mergeable word: full word first, then punct trims. */
function endVariants(word: string, tokenStart: number): number[] {
	const variants = [tokenStart + word.length]
	let end = word.length
	while (end > 0 && /[,.;:!?\])}]/u.test(word[end - 1] ?? '')) {
		end -= 1
		variants.push(tokenStart + end)
	}
	return variants
}

/** A merge joins raw words: quoted or escaped words would misalign offsets. */
function isMergeableWord(match: RegExpMatchArray): boolean {
	const [word = ''] = match
	if (!word) return false
	const [first] = word
	return first !== '"' && first !== "'" && decodeShellWord(word) === word
}

/** Strip one level of shell quoting and backslash escaping. */
function decodeShellWord(token: string): string {
	if (token.startsWith("'") && token.endsWith("'")) return token.slice(1, -1)
	if (token.startsWith('"') && token.endsWith('"')) return token.slice(1, -1)
	return token.replace(/\\(.)/gu, '$1')
}

/** Offsets where a decoded token plausibly starts a path. */
function pathStartIndexes(pathText: string): number[] {
	const indexes: number[] = []
	for (let index = 0; index < pathText.length; index += 1) {
		if (looksLikePath(pathText.slice(index))) indexes.push(index)
	}
	return indexes
}

/** Path end offsets inside a token, longest first, trimming trailing punct. */
function pathEndIndexes(pathText: string, start: number): number[] {
	const indexes = [pathText.length]
	let end = pathText.length
	while (end > start && /[,.;:!?\])}]/u.test(pathText[end - 1] ?? '')) {
		end -= 1
		indexes.push(end)
	}
	return indexes
}
