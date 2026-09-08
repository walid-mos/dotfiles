/**
 * Autocomplete provider for `/skill:` tokens typed mid-prompt.
 *
 * Wraps the built-in provider (single source of truth for the command list).
 * When the cursor is inside a `/skill:` token, returns fuzzy-filtered skill
 * commands; otherwise delegates untouched.
 */
import { fuzzyFilter } from '@earendil-works/pi-tui'

import { applyInlineSkillCompletion } from './apply.ts'
import { isSkillTokenContext, SKILL_TOKEN_RE } from './token.ts'

import type {
	AutocompleteItem,
	AutocompleteProvider,
	AutocompleteSuggestions,
} from '@earendil-works/pi-tui'
import type { AppliedCompletion, CompletionContext } from './apply.ts'

// Query the built-in menu from its home position: first line, first column
const HOME_CURSOR_COL = 1

type ProviderOptions = { signal: AbortSignal; force?: boolean }

type SkillQuery = {
	lines: string[]
	cursorLine: number
	cursorCol: number
	options: ProviderOptions
}

type CursorQuery = {
	lines: string[]
	cursorLine: number
	cursorCol: number
}

type ProviderApplyArgs = Parameters<AutocompleteProvider['applyCompletion']>

/** Fallback customization: replay the context onto the wrapped autocomplete implementation. */
function builtInFallback(
	current: AutocompleteProvider,
): (context: CompletionContext) => AppliedCompletion {
	return context =>
		current.applyCompletion(
			context.lines,
			context.cursorLine,
			context.cursorCol,
			context.completion,
			context.prefix,
		)
}

/** Fuzzy-filter the `/skill:` command items against the typed prefix. */
async function skillSuggestions(
	current: AutocompleteProvider,
	query: SkillQuery,
): Promise<AutocompleteSuggestions | null> {
	const currentLine = query.lines[query.cursorLine] ?? ''
	const match = currentLine.slice(0, query.cursorCol).match(SKILL_TOKEN_RE)
	if (!match) {
		return current.getSuggestions(
			query.lines,
			query.cursorLine,
			query.cursorCol,
			query.options,
		)
	}

	// group 1 = full token, group 2 = typed prefix; SKILL token match
	const [, fullToken, typedPrefix] = match

	// Same command list the built-in slash menu uses (skills, extension
	// commands, prompt templates, …).
	const allCommands = await current.getSuggestions(
		['/'],
		0,
		HOME_CURSOR_COL,
		query.options,
	)
	const skillCommands =
		allCommands?.items.filter(command =>
			command.value.startsWith('skill:'),
		) ?? []
	if (!skillCommands.length) return null
	if (!fullToken) {
		// The regex carries a mandatory token group: unreachable in practice.
		return null
	}

	const filtered: AutocompleteItem[] = typedPrefix
		? fuzzyFilter(skillCommands, typedPrefix, command => command.value)
		: skillCommands

	return {
		items: filtered.map(command => {
			const row: AutocompleteItem = {
				value: command.value, // "skill:swarm"
				label: command.label,
			}
			if (command.description) row.description = command.description
			return row
		}),
		prefix: fullToken,
	}
}

/** Apply a confirmed completion inline for skill tokens, delegate otherwise. */
function applyProviderCompletion(
	current: AutocompleteProvider,
	applyArgs: ProviderApplyArgs,
): AppliedCompletion {
	const [lines, cursorLine, cursorCol, completion, prefix] = applyArgs
	return applyInlineSkillCompletion(builtInFallback(current), {
		lines,
		cursorLine,
		cursorCol,
		completion,
		prefix,
	})
}

/** Inside a /skill: token, Tab must open the skill menu, not files. */
export function shouldTriggerSkillCompletion(
	current: AutocompleteProvider,
	cursorQuery: CursorQuery,
): boolean {
	const currentLine = cursorQuery.lines[cursorQuery.cursorLine] ?? ''
	if (isSkillTokenContext(currentLine.slice(0, cursorQuery.cursorCol))) {
		return false
	}
	return (
		current.shouldTriggerFileCompletion?.(
			cursorQuery.lines,
			cursorQuery.cursorLine,
			cursorQuery.cursorCol,
		) ?? true
	)
}

function queryOf(
	lines: string[],
	cursorLine: number,
	cursorCol: number,
	options: ProviderOptions,
): SkillQuery {
	return { lines, cursorLine, cursorCol, options }
}

function cursorQueryOf(
	lines: string[],
	cursorLine: number,
	cursorCol: number,
): CursorQuery {
	return { lines, cursorLine, cursorCol }
}

export function createInlineSkillsProvider(
	current: AutocompleteProvider,
): AutocompleteProvider {
	return {
		getSuggestions: (lines, cursorLine, cursorCol, options) =>
			skillSuggestions(
				current,
				queryOf(lines, cursorLine, cursorCol, options),
			),
		applyCompletion: (...applyArgs) =>
			applyProviderCompletion(current, applyArgs),
		shouldTriggerFileCompletion: (lines, cursorLine, cursorCol) =>
			shouldTriggerSkillCompletion(
				current,
				cursorQueryOf(lines, cursorLine, cursorCol),
			),
	}
}
