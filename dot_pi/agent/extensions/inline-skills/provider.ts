/**
 * Autocomplete provider for `/skill:` tokens typed mid-prompt.
 *
 * Wraps the built-in provider (single source of truth for the command list).
 * When the cursor is inside a `/skill:` token, returns fuzzy-filtered skill
 * commands; otherwise delegates untouched.
 */
import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from "@earendil-works/pi-tui";
import { fuzzyFilter } from "@earendil-works/pi-tui";
import { applyInlineSkillCompletion } from "./apply.ts";
import { isSkillTokenContext, SKILL_TOKEN_RE } from "./token.ts";

export function createInlineSkillsProvider(current: AutocompleteProvider): AutocompleteProvider {
	return {
		async getSuggestions(
			lines: string[],
			cursorLine: number,
			cursorCol: number,
			options: { signal: AbortSignal; force?: boolean },
		): Promise<AutocompleteSuggestions | null> {
			const currentLine = lines[cursorLine] ?? "";
			const match = currentLine.slice(0, cursorCol).match(SKILL_TOKEN_RE);
			if (!match) {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			const fullToken = match[1]!; // "/skill:sw"
			const typedPrefix = match[2]!; // "sw"

			// Same command list the built-in slash menu uses (skills, extension
			// commands, prompt templates, …).
			const allCommands = await current.getSuggestions(["/"], 0, 1, options);
			const skillItems = allCommands?.items.filter((item) => item.value.startsWith("skill:")) ?? [];
			if (skillItems.length === 0) return null;

			const filtered: AutocompleteItem[] = typedPrefix
				? fuzzyFilter(skillItems, typedPrefix, (item) => item.value)
				: skillItems;

			return {
				items: filtered.map((item) => ({
					value: item.value, // "skill:swarm"
					label: item.label,
					description: item.description,
				})),
				prefix: fullToken,
			};
		},

		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			return applyInlineSkillCompletion(
				current.applyCompletion.bind(current),
				lines,
				cursorLine,
				cursorCol,
				item,
				prefix,
			);
		},

		shouldTriggerFileCompletion(lines: string[], cursorLine: number, cursorCol: number): boolean {
			// Inside a /skill: token, Tab must open the skill menu, not files.
			const currentLine = lines[cursorLine] ?? "";
			if (isSkillTokenContext(currentLine.slice(0, cursorCol))) {
				return false;
			}
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}