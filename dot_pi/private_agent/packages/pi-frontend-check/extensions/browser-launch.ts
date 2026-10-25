import { resolveExecutable } from './config.ts'

import type {
	Browser,
	BrowserContext,
	BrowserContextOptions,
	BrowserType,
	LaunchOptions,
} from 'playwright-core'
import type { Config } from './schema.ts'

let chromiumType: BrowserType | undefined

export async function loadChromium(): Promise<BrowserType> {
	chromiumType ??= (await import('playwright-core')).chromium
	return chromiumType
}

export function launchOptions(config: Config): LaunchOptions {
	return {
		executablePath: resolveExecutable(config.EXECUTABLE_PATH),
		headless: true,
		timeout: config.NAV_TIMEOUT_MS,
		chromiumSandbox: true,
		ignoreDefaultArgs: ['--disable-extensions'],
		// No disk or shader cache: a verification browser never serves a stale asset and its profile holds login state only.
		args: ['--disk-cache-size=1', '--disable-gpu-shader-disk-cache'],
	}
}

export function contextOptions(config: Config): BrowserContextOptions {
	return {
		viewport: {
			width: config.VIEWPORT_WIDTH,
			height: config.VIEWPORT_HEIGHT,
		},
		deviceScaleFactor: 1,
		acceptDownloads: false,
	}
}

export async function launchBrowser(config: Config): Promise<Browser> {
	return (await loadChromium()).launch(launchOptions(config))
}

export async function openContext(
	browser: Browser,
	config: Config,
): Promise<BrowserContext> {
	const context = await browser.newContext(contextOptions(config))
	context.setDefaultTimeout(config.ACTION_TIMEOUT_MS)
	context.setDefaultNavigationTimeout(config.NAV_TIMEOUT_MS)
	return context
}
