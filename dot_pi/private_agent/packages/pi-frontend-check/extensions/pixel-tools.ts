// frontend_pixels: exact raster evidence for the explicitly requested
// zero-pixel mode - capture an exact PNG of the open page state, or compare two
// captures byte-for-byte. A FAIL reports where the changed pixels sit so the
// next step is a measurement, not another capture.
import { capturePixels, loadPixelPair, runPixelDiff } from './pixel-diff.ts'
import { pixelsSchema } from './schema.ts'
import { registerFrontendTool } from './tool-registration.ts'
import { textResult } from './tool-results.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { FrontendBrowser } from './browser.ts'
import type { Config, PixelsOptions } from './schema.ts'

function requireField<
	Key extends 'name' | 'wait_for' | 'captured_a' | 'captured_b',
>(options: PixelsOptions, key: Key): NonNullable<PixelsOptions[Key]> {
	const fieldValue = options[key]
	if (!fieldValue)
		throw new Error(`frontend_pixels mode=${options.mode} requires ${key}.`)
	return fieldValue
}

export function registerPixelsTool(
	pi: ExtensionAPI,
	browser: FrontendBrowser,
	config: () => Config,
): void {
	registerFrontendTool(pi, browser, {
		name: 'frontend_pixels',
		label: 'Frontend Pixels',
		parameters: pixelsSchema,
		description:
			'Exact raster mode only - use when the manifest records an explicit zero-pixel requirement; default parity evidence is frontend_compare. mode=capture saves an exact PNG of the current page state: wait_for must name a state-specific visible element (not body/html/*); fonts and images in scope are awaited, animations disabled; selector captures one element, otherwise the viewport. Prepare equivalent data, persona, locale and viewport on both sides first. mode=diff compares two captures: PASS only for equal dimensions and zero changed RGBA pixels; element captures ignore where the element sits in its page. A FAIL names the changed region and its page position; measure the styles under it before recapturing - a new capture of the same state is not progress.',
		execute: async (...args) => {
			const [, options, signal] = args
			if (options.mode === 'capture')
				return textResult(
					await capturePixels(
						browser,
						requireField(options, 'name'),
						{
							wait_for: requireField(options, 'wait_for'),
							selector: options.selector,
						},
					),
				)
			const pair = await loadPixelPair(
				requireField(options, 'captured_a'),
				requireField(options, 'captured_b'),
			)
			return textResult(await runPixelDiff(pair, config(), signal))
		},
	})
}
