import standards from '@nextnode-solutions/standards/oxlint'
import { defineConfig } from 'oxlint'

export default defineConfig({
	extends: [standards],
	// Machine state under ~/.pi/agent: never scan (sessions are jsonl anyway,
	// but skipping them keeps scans fast and private data out of the report).
	// NOTE: setting ignorePatterns overrides oxlint's default node_modules
	// ignore, so it is listed explicitly.
	ignorePatterns: ['node_modules/**', 'sessions/**', 'npm/**', 'bin/**'],
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
	],
})
