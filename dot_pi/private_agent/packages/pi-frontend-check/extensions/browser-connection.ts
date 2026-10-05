import { resolveExecutable } from './config.ts'
import { sessionProfileDir } from './profile-store.ts'

import type {
	Browser,
	BrowserContext,
	BrowserType,
	Page,
} from 'playwright-core'
import type { Config } from './schema.ts'

let chromiumModule: { chromium: BrowserType } | undefined

async function connectSharedBrowser(config: Config): Promise<{
	browser: Browser
	context: BrowserContext
}> {
	chromiumModule ??= { chromium: (await import('playwright-core')).chromium }
	const browser = await chromiumModule.chromium.connectOverCDP(
		config.CDP_URL,
		{
			timeout: config.NAV_TIMEOUT_MS,
			noDefaults: true,
		},
	)
	const [context] = browser.contexts()
	if (context) return { browser, context }
	await browser.close()
	throw new Error('The shared browser has no persistent default context.')
}

function contextOptions(config: Config): {
	viewport: { width: number; height: number }
	deviceScaleFactor: number
	acceptDownloads: boolean
} {
	return {
		viewport: {
			width: config.VIEWPORT_WIDTH,
			height: config.VIEWPORT_HEIGHT,
		},
		deviceScaleFactor: 1,
		acceptDownloads: false,
	}
}

/** A named session owns a persistent profile: cookies survive relaunches and resume. */
async function connectSessionBrowser(
	config: Config,
	sessionKey: string,
): Promise<{
	browser: Browser
	context: BrowserContext
}> {
	chromiumModule ??= { chromium: (await import('playwright-core')).chromium }
	const context = await chromiumModule.chromium.launchPersistentContext(
		sessionProfileDir(sessionKey),
		{
			executablePath: resolveExecutable(config.EXECUTABLE_PATH),
			headless: true,
			timeout: config.NAV_TIMEOUT_MS,
			chromiumSandbox: true,
			...contextOptions(config),
		},
	)
	const browser = context.browser()
	if (!browser)
		throw new Error('The persistent browser context has no browser handle.')
	return { browser, context }
}

async function connectEphemeralBrowser(config: Config): Promise<{
	browser: Browser
	context: BrowserContext
}> {
	chromiumModule ??= { chromium: (await import('playwright-core')).chromium }
	const browser = await chromiumModule.chromium.launch({
		executablePath: resolveExecutable(config.EXECUTABLE_PATH),
		headless: true,
		timeout: config.NAV_TIMEOUT_MS,
		chromiumSandbox: true,
	})
	try {
		const context = await browser.newContext(contextOptions(config))
		return { browser, context }
	} catch (error) {
		await browser.close()
		throw error
	}
}

/** CDP attach when configured; otherwise a per-session persistent or an ephemeral browser. */
async function connectBrowser(
	config: Config,
	sessionKey?: string,
): Promise<{ browser: Browser; context: BrowserContext }> {
	if (config.CDP_URL) return connectSharedBrowser(config)
	if (sessionKey) return connectSessionBrowser(config, sessionKey)
	return connectEphemeralBrowser(config)
}

/** Own this client's pages, never another client's shared context or browser process. */
export class BrowserConnection {
	private browser: Browser | undefined
	private context: BrowserContext | undefined
	private page: Page | undefined
	private pages = new Set<Page>()
	private mode: 'shared' | 'isolated' = 'isolated'
	private profileKey: string | undefined
	private observe: (page: Page) => void

	constructor(observe: (page: Page) => void) {
		this.observe = observe
	}

	get isConnected(): boolean {
		return this.browser?.isConnected() ?? false
	}

	get currentUrl(): string {
		return this.page?.url() ?? '(none)'
	}

	async ensurePage(
		config: Config,
		signal?: AbortSignal,
		sessionKey?: string,
	): Promise<Page> {
		if (this.isConnected && this.context && this.profileKey === sessionKey)
			return this.page && !this.page.isClosed()
				? this.page
				: this.newPage(config)
		await this.close()
		this.mode = config.CDP_URL ? 'shared' : 'isolated'
		this.profileKey = sessionKey
		try {
			const connection = await connectBrowser(config, sessionKey)
			this.browser = connection.browser
			this.context = connection.context
			signal?.throwIfAborted()
			this.context.setDefaultTimeout(config.ACTION_TIMEOUT_MS)
			this.context.setDefaultNavigationTimeout(config.NAV_TIMEOUT_MS)
			return await this.newPage(config)
		} catch (error) {
			await this.close()
			throw new Error(
				`Could not start the ${this.mode} frontend browser: ${error instanceof Error ? error.message : String(error)}`,
				{ cause: error },
			)
		}
	}

	private trackPage(page: Page): void {
		this.pages.add(page)
		this.page = page
		this.observe(page)
		page.on('popup', popup => this.trackPage(popup))
		page.on('close', () => this.pages.delete(page))
	}

	private async newPage(config: Config): Promise<Page> {
		if (!this.context) throw new Error('No browser context is connected.')
		const page = await this.context.newPage()
		this.trackPage(page)
		await page.setViewportSize({
			width: config.VIEWPORT_WIDTH,
			height: config.VIEWPORT_HEIGHT,
		})
		return page
	}

	currentPage(): Page {
		const page = this.page?.isClosed() ? [...this.pages].at(-1) : this.page
		if (!page || page.isClosed())
			throw new Error('No page is open - call frontend_open first.')
		return page
	}

	async close(): Promise<void> {
		const { browser: closingBrowser } = this
		const ownedPages = [...this.pages]
		this.browser = undefined
		this.context = undefined
		this.page = undefined
		this.pages.clear()
		this.profileKey = undefined
		try {
			if (this.mode === 'shared')
				await Promise.all(ownedPages.map(page => page.close()))
		} finally {
			// Playwright disconnects a CDP client; the external browser stays alive.
			await closingBrowser?.close()
		}
	}
}
