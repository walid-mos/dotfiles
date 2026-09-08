/**
 * Insert a confirmed skill completion in place of the `/skill:` token.
 *
 * When the cursor is inside a `/skill:` token, the confirmed item (e.g.
 * "skill:swarm") is inserted with a leading slash and a trailing space so the
 * user can keep typing. Outside a `/skill:` context, we delegate to the
 * built-in completion behavior (covers `!shell` completions, etc.).
 */
import { isSkillTokenContext } from './token.ts'

/** Identity of the confirmed suggestion, exactly as pi-tui carries it. */
import type { AutocompleteItem } from '@earendil-works/pi-tui'

export type AppliedCompletion = {
	lines: string[]
	cursorLine: number
	cursorCol: number
}

export type CompletionItem = AutocompleteItem

/** Cursor context of an autocomplete apply call. */
export type CompletionContext = {
	lines: string[]
	cursorLine: number
	cursorCol: number
	completion: CompletionItem
	prefix: string
}

/**
 * Built-in completion fallback, invoked with the same cursor context when
 * the cursor is not inside a `/skill:` token.
 */
export type CompletionFallback = (
	context: CompletionContext,
) => AppliedCompletion

// The inserted token is "/" + value + " ": slash and trailing space
const SLASH_AND_TRAILING_SPACE = 2

/** Build the completion result for a `/skill:` token candidate. */
export function applySkillTokenCompletion(
	context: CompletionContext,
): AppliedCompletion {
	const { lines, cursorLine, cursorCol, completion, prefix } = context
	const currentLine = lines[cursorLine] ?? ''
	const before = currentLine.slice(0, cursorCol - prefix.length)
	const after = currentLine.slice(cursorCol)
	const newLine = `${before}/${completion.value} ${after}`
	const newLines = [...lines]
	newLines[cursorLine] = newLine

	return {
		lines: newLines,
		cursorLine,
		cursorCol:
			before.length + completion.value.length + SLASH_AND_TRAILING_SPACE,
	}
}

/**
 * Insert the confirmed completion: inline `/skill:` expansion when the
 * cursor sits in a skill token, built-in behavior otherwise.
 */
export function applyInlineSkillCompletion(
	fallback: CompletionFallback,
	context: CompletionContext,
): AppliedCompletion {
	const currentLine = context.lines[context.cursorLine] ?? ''
	const textBefore = currentLine.slice(0, context.cursorCol)
	if (!isSkillTokenContext(textBefore)) {
		return fallback(context)
	}
	return applySkillTokenCompletion(context)
}
