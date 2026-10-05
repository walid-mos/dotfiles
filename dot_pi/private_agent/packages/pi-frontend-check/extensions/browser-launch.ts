// Shared browser launch helpers for cold, single-purpose pages (diffs, pixel
// comparisons): one Chromium, one fresh context with the house viewport options.
import { resolveExecutable } from './config.ts'

import type { Browser, BrowserContext, BrowserType } from 'playwright-core'
import type { Config } from './schema.ts'

let chromiumModule: { chromium: BrowserType } | undefined

export async function launchBrowser(config: Config): Promise<Browser> {
	chromiumModule ??= { chromium: (await import('playwright-core')).chromium }
	return chromiumModule.chromium.launch({
		executablePath: resolveExecutable(config.EXECUTABLE_PATH),
		headless: true,
		timeout: config.NAV_TIMEOUT_MS,
		chromiumSandbox: true,
	})
}

export async function openContext(
	browser: Browser,
	config: Config,
): Promise<BrowserContext> {
	const context = await browser.newContext({
		viewport: {
			width: config.VIEWPORT_WIDTH,
			height: config.VIEWPORT_HEIGHT,
		},
		deviceScaleFactor: 1,
		acceptDownloads: false,
	})
	context.setDefaultTimeout(config.ACTION_TIMEOUT_MS)
	context.setDefaultNavigationTimeout(config.NAV_TIMEOUT_MS)
	return context
}
