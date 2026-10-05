/**
 * Frontend checks in isolated Brave or the managed shared browser via CDP.
 * browser.ts owns session resources and serialized, cancellable operations;
 * scenario.ts owns scripted, parallel runs in their own contexts;
 * schema/config own validated settings; tools.ts registers the tools.
 * Pi and the house renderers own all tool presentation (no compact-tools patch).
 */
import { FrontendBrowser } from './browser.ts'
import { frontendCommand } from './command.ts'
import { loadConfig } from './config.ts'
import { sweepStaleProfileDirs } from './profile-store.ts'
import { registerProgressRecovery } from './progress-recovery.ts'
import { registerFrontendTools } from './tools.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export default function frontendCheck(pi: ExtensionAPI): void {
	try {
		sweepStaleProfileDirs()
	} catch {
		// A failing profile sweep must not block the extension load.
	}
	let config = loadConfig()
	const browser = new FrontendBrowser(config)
	registerFrontendTools(pi, browser, () => config)
	registerProgressRecovery(pi)
	pi.on('session_shutdown', () => browser.shutdown())
	pi.registerCommand('frontend-check', {
		description:
			'Status; set KEY=VALUE; save; reset (release browser connection)',
		handler: async (args, context) => {
			try {
				const message = await browser.run(async () => {
					const update = await frontendCommand(args, browser, config)
					config = update.config
					return update.message
				})
				if (context.hasUI) context.ui.notify(message, 'info')
				else
					pi.sendMessage({
						customType: 'frontend-check',
						content: message,
						display: true,
					})
			} catch (error) {
				if (!context.hasUI) throw error
				context.ui.notify(String(error), 'error')
			}
		},
	})
}
