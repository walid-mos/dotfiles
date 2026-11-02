import { fileURLToPath } from 'node:url'

import { FrontendBrowser } from './extensions/browser.ts'
import { validateConfig } from './extensions/config.ts'
import { defaults } from './extensions/schema.ts'

import type { PackageAuditContext } from '../../skills/pi-updated/scripts/lib-package-audit.ts'

export async function audit(context: PackageAuditContext): Promise<string[]> {
	const browser = new FrontendBrowser(
		validateConfig({ ...defaults, CDP_URL: '' }),
	)
	const manifest = fileURLToPath(new URL('./package.json', import.meta.url))
	try {
		await browser.run(() =>
			browser.open(
				{ url: manifest, wait_for: 'body' },
				context.temporaryDirectory,
			),
		)
		await browser.run(() =>
			browser.actMany(
				[
					{
						id: 'navigate',
						action: 'goto',
						url: manifest,
						wait_for: 'body',
					},
				],
				context.temporaryDirectory,
			),
		)
		const name = await browser.run(() =>
			browser.evaluate('JSON.parse(document.body.innerText).name'),
		)
		if (JSON.parse(name) !== 'pi-frontend-check')
			throw new Error(`Unexpected browser page: ${name}`)
		const screenshot = await browser.run(() => browser.screenshot())
		if (screenshot.type !== 'image' || !screenshot.data)
			throw new Error('Brave returned no screenshot')
		const diagnostics = browser.console()
		if (/pageerror|requestfailed/.test(diagnostics))
			throw new Error(diagnostics)
		return [
			'installed Pi schemas and config validate',
			'isolated Brave opened the package manifest, batch navigation and DOM evaluation succeeded',
			'screenshot captured and browser shutdown completed',
		]
	} finally {
		await browser.shutdown()
	}
}
