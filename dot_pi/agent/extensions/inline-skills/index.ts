/**
 * inline-skills — invoke skills anywhere in the prompt, with autocomplete.
 *
 * The built-in slash-command autocomplete only opens at the very start of a
 * message, and its native expansion only loads a SINGLE skill. This extension:
 *
 * 1. Adds an autocomplete provider that intercepts `/skill:...` mid-line and
 *    returns fuzzy-filtered skill names from the built-in command registry.
 * 2. Wraps the editor so the popup auto-opens when `/skill:` is typed
 *    mid-line. Escape closes it; Tab / Enter confirm.
 * 3. Expands EVERY `/skill:` token in a submitted prompt into its `<skill>`
 *    content block, before the native single-skill expansion runs.
 *
 * Usage:
 *   audit this codebase /skill:swarm /skill:stack
 *                 ^-- popup after `:`       ^-- and here
 *
 *   Text between two tokens becomes the args of the earlier skill:
 *   /skill:stack open a clean PR /skill:swarm
 *   → stack block + "open a clean PR" + swarm block.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { installInlineSkillTrigger } from "./editor-trigger.ts";
import {
	adoptLoadedSkills,
	expandAllSkills,
	getSkills,
	resetSkillsCache,
} from "./expansion.ts";
import { createInlineSkillsProvider } from "./provider.ts";

export default function (pi: ExtensionAPI): void {
	pi.on("session_start", (event, ctx) => {
		// Refresh the skill cache when resources are reloaded.
		if (event.reason === "reload") {
			resetSkillsCache();
		}

		// Autocomplete: handles /skill: tokens mid-line (delegates otherwise).
		ctx.ui.addAutocompleteProvider(createInlineSkillsProvider);

		// Editor wrapper: auto-opens the popup on mid-line `/skill:` typing.
		// The interactive mode copies paddingX / autocompleteMaxVisible /
		// borderColor / callbacks from the default editor (see
		// setCustomEditorComponent), so empty options are fine.
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			const editor = new CustomEditor(tui, theme, keybindings, {});
			installInlineSkillTrigger(editor);
			return editor;
		});
	});

	// Adopt pi's exact loaded skill list once an agent run starts
	// (covers skills shipped in npm packages, which re-discovery misses).
	pi.on("before_agent_start", (event) => {
		adoptLoadedSkills(event.systemPromptOptions.skills, event.systemPromptOptions.cwd);
	});

	// Expand every /skill: token in the submitted prompt, so chained skills
	// are all loaded — not just the first one at the start.
	pi.on("input", (event, ctx) => {
		if (!event.text.includes("/skill:")) {
			return { action: "continue" as const };
		}
		// Seeded lazily; before_agent_start keeps it in sync with pi's list.
		const skills = getSkills(ctx);
		const expanded = expandAllSkills(event.text, skills);
		if (expanded === event.text) {
			return { action: "continue" as const };
		}
		return { action: "transform" as const, text: expanded };
	});
}
