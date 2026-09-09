import standards from '@nextnode-solutions/standards/oxlint'
import { defineConfig } from 'oxlint'

export default defineConfig({
	extends: [standards],
	// Machine state under ~/.pi/agent: never scan (sessions are jsonl anyway,
	// but skipping them keeps scans fast and private data out of the report).
	// backups/ holds point-in-time config snapshots that supersede nothing.
	// NOTE: setting ignorePatterns overrides oxlint's default node_modules
	// ignore, so it is listed explicitly.
	ignorePatterns: [
		'node_modules/**',
		'sessions/**',
		'npm/**',
		'bin/**',
		'backups/**',
		// Vendor-managed by `herdr integration install pi`; never hand-edit.
		'extensions/herdr-agent-state.ts',
	],
	overrides: [
		{
			// Pi extension entry points are default-exported by design, same
			// class of exception as framework pages in the shared preset
			// (app/**/page.tsx, pages/**, middleware.ts, ...)
			files: ['extensions/**'],
			rules: {
				'import/no-default-export': 'off',
			},
		},
		{
			// Test assertions match raw ANSI escape sequences; widths and
			// offsets in render expectations are test fixtures, not logic.
			files: ['tests/**'],
			rules: {
				'eslint/no-control-regex': 'off',
			},
		},
	],
})
