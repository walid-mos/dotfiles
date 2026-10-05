// Pi tool registration for exact pixels and branch-persistent progress checks.
import { capturePixels } from './pixel-diff.ts'
import { runProgressPixelDiff } from './pixel-progress-run.ts'
import { PIXEL_PROGRESS_ENTRY } from './pixel-progress.ts'
import { capturePixelsSchema, pixelDiffSchema } from './schema.ts'
import { SerialQueue } from './serial-queue.ts'
import { textResult } from './tool-results.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { FrontendBrowser } from './browser.ts'
import type { Config } from './schema.ts'

function registerCapture(pi: ExtensionAPI, browser: FrontendBrowser): void {
	pi.registerTool({
		name: 'frontend_capture_pixels',
		label: 'Frontend Capture Pixels',
		parameters: capturePixelsSchema,
		description:
			'Save an exact PNG of the current Brave session state. Required wait_for must identify a state-specific visible element (not body/html/*); then wait for fonts and the images relevant to the scope, failing on broken ones. Captures the viewport or one strict selector, with animations disabled; no masking or tolerance. Navigate and set the persona/data first. Capture implementation and deployed prototype at the same desktop viewport, browser and equivalent region, then use frontend_pixel_diff. A capture is evidence, not a parity verdict. After a failed comparison, diagnose before recapturing: another comparison requires a new evidence-backed probe, not merely new PNGs or names.',
		execute: async (_id, options, signal) =>
			textResult(
				await browser.run(
					() => capturePixels(browser, options.name, options),
					signal,
				),
			),
	})
}

function registerComparison(
	pi: ExtensionAPI,
	browser: FrontendBrowser,
	config: () => Config,
): void {
	const queue = new SerialQueue()
	pi.registerTool({
		name: 'frontend_pixel_diff',
		label: 'Frontend Pixel Diff',
		parameters: pixelDiffSchema,
		description:
			'Compare two captured PNGs exactly in isolated Brave: PASS only for zero changed pixels and matching viewport, capture kind, position and dimensions. Prepare equivalent data/fonts/locale/state; selector spelling may differ. Identical PNG bytes plus metadata reuse the recorded verdict without a browser or model call. After a FAIL on this URL/scope pair, changed images alone do not justify continuing: supply probe {hypothesis, expected_effect, evidence_entry} using the Evidence reference returned by frontend_eval (or a recorded tool-call/entry ID). The successful result is resolved directly, without copying JSON. Keep it under 2000 characters; for longer source results, add evidence_quote with an exact excerpt. Only recorded successful DOM/style/source results on this branch qualify. Jev admits only a supported new diagnostic or correction verification; unknown/unsupported repetitions stay blocked. Probe evidence is sent to the existing Jev service; never cite secrets. Receipt history survives compaction/reload. No fixed retry count or task timer. Jev can authorize a probe, never a pixel PASS or release waiver. This is not business-flow coverage.',
		execute: async (...args) => {
			const [, options, signal, , context] = args
			return queue.run(async () => {
				const comparison = await runProgressPixelDiff(
					options,
					config(),
					{
						journal: {
							entries: () => context.sessionManager.getBranch(),
							append: receipt =>
								pi.appendEntry(PIXEL_PROGRESS_ENTRY, receipt),
						},
						redact: text => browser.redact(text),
					},
					signal,
				)
				return {
					...textResult(comparison.text),
					details: { pixelProgress: comparison.action },
				}
			}, signal)
		},
	})
}

export function registerPixelTools(
	pi: ExtensionAPI,
	browser: FrontendBrowser,
	config: () => Config,
): void {
	registerCapture(pi, browser)
	registerComparison(pi, browser, config)
}
