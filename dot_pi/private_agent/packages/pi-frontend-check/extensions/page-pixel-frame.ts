import type { Locator, Page } from 'playwright-core'

export interface PixelFrame {
	png: Buffer
	url: string
	viewport: { width: number; height: number }
	position: { x: number; y: number }
}

async function waitForCaptureAssets(
	page: Page,
	target?: Locator,
): Promise<void> {
	const candidates = target
		? target.locator('img').or(target)
		: page.locator('img')
	await candidates.evaluateAll(
		async (elements, captureKind) => {
			await document.fonts.ready
			const images = elements
				.filter(
					(element): element is HTMLImageElement =>
						element instanceof HTMLImageElement,
				)
				.filter(image => {
					if (
						!image.checkVisibility({
							opacityProperty: true,
							visibilityProperty: true,
						})
					)
						return false
					if (captureKind === 'element') return true
					const rect = image.getBoundingClientRect()
					return (
						rect.bottom > 0 &&
						rect.right > 0 &&
						rect.top < innerHeight &&
						rect.left < innerWidth
					)
				})
			await Promise.all(
				images.map(image =>
					image.decode().catch(cause => {
						throw new Error(
							`Image in the capture scope failed to load: ${image.currentSrc || image.src || '(no source)'}. Fix it before capturing.`,
							{ cause },
						)
					}),
				),
			)
		},
		target ? 'element' : 'viewport',
	)
}

export async function capturePixelFrame(
	page: Page,
	waitFor: string,
	selector: string | undefined,
	assertSafe: () => void,
): Promise<PixelFrame> {
	assertSafe()
	await page.locator(waitFor).waitFor({ state: 'visible' })
	const target = selector ? page.locator(selector) : undefined
	if (target && (await target.count()) !== 1)
		throw new Error(
			`Pixel capture selector must match exactly one element: ${selector}`,
		)
	await target?.scrollIntoViewIfNeeded()
	await waitForCaptureAssets(page, target)
	assertSafe()
	const png = target
		? await target.screenshot({
				type: 'png',
				animations: 'disabled',
				caret: 'hide',
			})
		: await page.screenshot({
				type: 'png',
				fullPage: false,
				animations: 'disabled',
				caret: 'hide',
			})
	const viewport = page.viewportSize()
	if (!viewport) throw new Error('Pixel capture requires a fixed viewport.')
	const box = await target?.boundingBox()
	if (target && !box) throw new Error('Pixel capture scope is not visible.')
	return {
		png,
		url: page.url(),
		viewport,
		position: { x: box?.x ?? 0, y: box?.y ?? 0 },
	}
}
