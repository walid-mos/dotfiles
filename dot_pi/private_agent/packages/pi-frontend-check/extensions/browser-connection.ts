import {
	contextOptions,
	launchBrowser,
	launchOptions,
	loadChromium,
	openContext,
} from './browser-launch.ts'
import { sessionProfileDir } from './profile-store.ts'

import type { Browser, BrowserContext, Page } from 'playwright-core'
import type { Config } from './schema.ts'

type ConnectedBrowser = {
	browser: Browser
	context: BrowserContext
	page?: Page | undefined
}

async function connectSharedBrowser(config: Config): Promise<ConnectedBrowser> {
	const browser = await (
		await loadChromium()
	).connectOverCDP(config.CDP_URL, {
		timeout: config.NAV_TIMEOUT_MS,
		noDefaults: true,
	})
	const [context] = browser.contexts()
	if (context) return { browser, context }
	await browser.close()
	throw new Error('The shared browser has no persistent default context.')
}

/** A persistent context opens with a blank tab (plus restored tabs on relaunch): keep one, close the rest. */
async function adoptStartupTab(
	context: BrowserContext,
): Promise<Page | undefined> {
	const open = context.pages()
	const kept = open.find(page => page.url() === 'about:blank') ?? open[0]
	await Promise.all(
		open
			.filter(page => page !== kept)
			.map(page => page.close().catch(() => undefined)),
	)
	return kept
}

/** A named session owns a persistent profile: cookies survive relaunches and resume. */
async function connectSessionBrowser(
	config: Config,
	sessionKey: string,
): Promise<ConnectedBrowser> {
	const context = await (
		await loadChromium()
	).launchPersistentContext(sessionProfileDir(sessionKey), {
		...launchOptions(config),
		...contextOptions(config),
	})
	const browser = context.browser()
	if (!browser)
		throw new Error('The persistent browser context has no browser handle.')
	return { browser, context, page: await adoptStartupTab(context) }
}

async function connectEphemeralBrowser(
	config: Config,
): Promise<ConnectedBrowser> {
	const browser = await launchBrowser(config)
	try {
		return { browser, context: await openContext(browser, config) }
	} catch (error) {
		await browser.close()
		throw error
	}
}

/** CDP attach when configured; otherwise a per-session persistent or an ephemeral browser. */
async function connectBrowser(
	config: Config,
	sessionKey?: string,
): Promise<ConnectedBrowser> {
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
			return connection.page
				? await this.sizePage(connection.page, config)
				: await this.newPage(config)
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
		return this.sizePage(await this.context.newPage(), config)
	}

	private async sizePage(page: Page, config: Config): Promise<Page> {
		this.trackPage(page)
		await page.setViewportSize({
			width: config.VIEWPORT_WIDTH,
			height: config.VIEWPORT_HEIGHT,
		})
		return page
	}

	/** Untracked on purpose: renderer work in this tab never becomes the current app page. */
	async withScratchPage<Result>(
		work: (page: Page) => Promise<Result>,
	): Promise<Result | undefined> {
		if (!this.isConnected || !this.context) return undefined
		const page = await this.context.newPage()
		try {
			return await work(page)
		} finally {
			await page.close().catch(() => undefined)
		}
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
