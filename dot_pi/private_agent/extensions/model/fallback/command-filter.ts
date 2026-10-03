/**
 * Slash-menu filter: the rows `/models` replaces, plus one row that cannot
 * answer on an interactive session.
 *
 * `/models` is this extension's entry point for choosing a
 * model, but pi's own `/model` and `/scoped-models` sit next to it in the
 * slash menu, and pi exposes no setting, flag or API to unregister a command
 * (`BUILTIN_SLASH_COMMANDS` is hardcoded, the interactive submit handler owns
 * those names, and `registerCommand` has no `hidden`). This provider wraps pi's
 * autocomplete and drops two groups:
 *
 * - pi's built-in `/model`, `/scoped-models` and `/thinking`, all replaced by
 *   the picker's own model and thinking-level editing;
 * - `llama` (pi's bundled llama.cpp router controller, with no llama provider
 *   in `settings.json` or `models.json`).
 *
 * The vendored `subagents` package no longer registers `subagents-models` or
 * `subagents-watchdog` (see `packages/subagents/FORK.md`), so neither is listed.
 *
 * Every hidden command still works when typed out in full.
 */
import type {
	AutocompleteProvider,
	AutocompleteSuggestions,
} from '@earendil-works/pi-tui'

/**
 * The rows kept out of the menu: the model commands the picker replaces, plus
 * the one row that is inert in an interactive session.
 */
const HIDDEN_COMMANDS = new Set(['model', 'scoped-models', 'thinking', 'llama'])

/**
 * True while the cursor sits in the leading `/command` token. Argument
 * completions live behind a space, so their items are never touched.
 */
function isCommandToken(
	lines: string[],
	cursorLine: number,
	cursorCol: number,
): boolean {
	const beforeCursor = (lines[cursorLine] ?? '').slice(0, cursorCol)
	return beforeCursor.startsWith('/') && !beforeCursor.includes(' ')
}

function withoutHiddenCommands(
	suggestions: AutocompleteSuggestions | null,
): AutocompleteSuggestions | null {
	if (!suggestions) return null
	const items = suggestions.items.filter(
		menuEntry => !HIDDEN_COMMANDS.has(menuEntry.value),
	)
	if (items.length === suggestions.items.length) return suggestions
	return { ...suggestions, items }
}

/**
 * Wrap pi's autocomplete provider so the slash menu lists `/models` only.
 */
export function createModelCommandFilter(
	current: AutocompleteProvider,
): AutocompleteProvider {
	return {
		...(current.triggerCharacters && {
			triggerCharacters: current.triggerCharacters,
		}),
		getSuggestions: async (lines, cursorLine, cursorCol, options) => {
			const suggestions = await current.getSuggestions(
				lines,
				cursorLine,
				cursorCol,
				options,
			)
			if (!isCommandToken(lines, cursorLine, cursorCol)) {
				return suggestions
			}
			return withoutHiddenCommands(suggestions)
		},
		applyCompletion: (
			...completion: Parameters<AutocompleteProvider['applyCompletion']>
		) => current.applyCompletion(...completion),
		shouldTriggerFileCompletion: (lines, cursorLine, cursorCol) =>
			current.shouldTriggerFileCompletion?.(
				lines,
				cursorLine,
				cursorCol,
			) ?? true,
	}
}
