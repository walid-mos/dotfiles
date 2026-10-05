import type { ImageContent } from '@earendil-works/pi-ai'
import type { Page, PageScreenshotOptions } from 'playwright-core'
import type { Config, ScreenshotOptions } from './schema.ts'

const MAX_SCREENSHOT_BYTES = 5242880

export async function capturePage(
	page: Page,
	config: Config,
	options: ScreenshotOptions,
): Promise<ImageContent> {
	const viewport = page.viewportSize() ?? {
		width: config.VIEWPORT_WIDTH,
		height: config.VIEWPORT_HEIGHT,
	}
	if (options.width || options.height) {
		await page.setViewportSize({
			width: options.width ?? viewport.width,
			height: options.height ?? viewport.height,
		})
	}
	const encoding: PageScreenshotOptions = {
		type: config.SHOT_FORMAT,
		animations: 'disabled',
	}
	if (config.SHOT_FORMAT === 'jpeg') encoding.quality = config.SHOT_QUALITY
	const image = options.selector
		? await page.locator(options.selector).screenshot(encoding)
		: await page.screenshot({
				...encoding,
				fullPage: options.full_page ?? config.FULL_PAGE,
			})
	// An empty buffer must never become an image part: pi persists it in the session
	// and replays it as an invalid data url on every later request.
	if (image.byteLength === 0) {
		const scope = options.selector
			? ` for selector "${options.selector}"`
			: ''
		throw new Error(
			`Empty screenshot: the capture returned 0 bytes${scope}; retry with a viewport, full_page, or another selector.`,
		)
	}
	if (image.byteLength > MAX_SCREENSHOT_BYTES)
		throw new Error(
			'Screenshot exceeds 5 MB; use a viewport or element capture instead.',
		)
	return {
		type: 'image',
		data: image.toString('base64'),
		mimeType: config.SHOT_FORMAT === 'png' ? 'image/png' : 'image/jpeg',
	}
}
