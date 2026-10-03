import standards from '@nextnode-solutions/standards/oxfmt'
import { defineConfig } from 'oxfmt'

// oxfmt has no `extends`: spread the shared preset object and layer local
// ignores. The preset ships as plain JavaScript, so the import widens its
// option literals (arrowParens, quotes...): assert once here, at this tooling
// boundary, instead of hand-typing the preset shape.
// oxlint-disable-next-line nextnode/no-type-assertion typescript/no-unsafe-type-assertion
const preset = standards as Parameters<typeof defineConfig>[0]

// dotfiles docs (AGENTS.md, skills) and Pi-managed state files are
// hand-maintained or owned by pi - never normalized.
export default defineConfig({
	...preset,
	ignorePatterns: [
		...(preset.ignorePatterns ?? []),
		'sessions/**',
		'npm/**',
		'bin/**',
		'frontend-check/**',
		'packages/**',
		'extensions/herdr-agent-state.ts',
		'extensions/herdr-pane-meta.ts',
		'**/*.md',
		'auth.json',
		'mcp.json',
		'mcp-cache.json',
		'mcp-npx-cache.json',
		'crashes.json',
		'frontend-check.json',
		'goal-widget.json',
		'herdr-task-names.json',
		'context-budget.json',
		'extensions/model/fallback/config.json',
		'extensions/subagent/config.json',
		'models.json',
		'models-store.json',
		'settings.json',
	],
})
