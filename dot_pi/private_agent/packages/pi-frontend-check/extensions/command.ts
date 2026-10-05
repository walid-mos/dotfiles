import { writeFile } from 'node:fs/promises'

import { withFileMutationQueue } from '@earendil-works/pi-coding-agent'

import { configPath, updateConfig } from './config.ts'

import type { FrontendBrowser } from './browser.ts'
import type { Config } from './schema.ts'

const JSON_INDENT = 2
const SET_PREFIX = 'set '

type CommandUpdate = { message: string; config: Config }

export async function frontendCommand(
	args: string,
	browser: FrontendBrowser,
	config: Config,
): Promise<CommandUpdate> {
	const command = args.trim()
	if (command === 'reset') {
		await browser.close()
		return {
			message: 'Frontend tabs closed; browser connection released.',
			config,
		}
	}
	if (command === 'save') {
		await withFileMutationQueue(configPath, () =>
			writeFile(
				configPath,
				`${JSON.stringify(config, null, JSON_INDENT)}\n`,
				{ mode: 0o600 },
			),
		)
		return { message: `Saved ${configPath}`, config }
	}
	if (command.startsWith(SET_PREFIX)) {
		const next = updateConfig(config, command.slice(SET_PREFIX.length))
		await browser.configure(next)
		return {
			message:
				'Setting applied for this session; browser closed. Use /frontend-check save to persist.',
			config: next,
		}
	}
	if (command)
		throw new Error('Use /frontend-check [set KEY=VALUE | save | reset].')
	return {
		message: `${browser.status()}\nConfig: ${configPath}\n${JSON.stringify(config, null, JSON_INDENT)}`,
		config,
	}
}
