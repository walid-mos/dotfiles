import standards from '@nextnode-solutions/standards/oxlint'
import { defineConfig } from 'oxlint'

export default defineConfig({
	extends: [standards],
	ignorePatterns: ['node_modules/**'],
	overrides: [
		{
			files: ['extensions/index.ts'],
			rules: { 'import/no-default-export': 'off' },
		},
	],
})
