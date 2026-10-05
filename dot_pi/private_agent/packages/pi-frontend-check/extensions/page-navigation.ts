import { visibleControls } from './page-controls.ts'

import type { Page } from 'playwright-core'

/** Discard a failed navigation, but retain a successfully loaded page for inspection. */
export async function navigatePage(
	page: Page,
	url: string,
	waitFor: string | undefined,
	context: { close: () => Promise<void>; redact: (text: string) => string },
): Promise<void> {
	try {
		await page.goto(url, { waitUntil: 'domcontentloaded' })
	} catch (error) {
		await context.close()
		throw error
	}
	if (!waitFor) return
	try {
		await page.locator(waitFor).waitFor({ state: 'visible' })
	} catch (error) {
		throw new Error(
			`Page loaded, but wait_for "${waitFor}" did not become visible: ${
				error instanceof Error ? error.message : String(error)
			}. The current page is still open with its loaded state - inspect the current DOM instead of reopening.\n${await visibleControls(page, context.redact)}`,
			{ cause: error },
		)
	}
}
