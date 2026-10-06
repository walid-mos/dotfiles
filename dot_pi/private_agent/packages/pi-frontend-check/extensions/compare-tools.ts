// frontend_compare: the three diagnostic comparisons behind one tool - freeze a
// specimen of the open page, diff two specimens (or cold URLs) by component
// styles/geometry/text, or judge the open page against a spec file. None of
// them is a pixel gate; frontend_pixels owns exact raster equality.
import { formatCaptureReport, saveSpecimen } from './capture-specimen.ts'
import { runIsoDiff } from './iso-diff.ts'
import { isJevConfigured } from './jev-client.ts'
import { compareSchema } from './schema.ts'
import { formatSpecReport, judgeSpec, loadSpecFile } from './spec-check.ts'
import { registerFrontendTool } from './tool-registration.ts'
import { textResult } from './tool-results.ts'

import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { FrontendBrowser } from './browser.ts'
import type { CompareOptions, Config } from './schema.ts'

const COLD_URL_SIDES = 2

function requireField<Key extends 'name' | 'file'>(
	options: CompareOptions,
	key: Key,
): NonNullable<CompareOptions[Key]> {
	const fieldValue = options[key]
	if (!fieldValue)
		throw new Error(
			`frontend_compare mode=${options.mode} requires ${key}.`,
		)
	return fieldValue
}

async function captureSpecimen(
	browser: FrontendBrowser,
	options: CompareOptions,
): Promise<AgentToolResult<unknown>> {
	// registerFrontendTool already runs execute inside browser.run; a nested
	// browser.run would enqueue behind this operation and self-deadlock.
	const specimen = await browser.specimen(options.wait_for, options.scope)
	const path = await saveSpecimen(requireField(options, 'name'), specimen)
	return textResult(formatCaptureReport(path, specimen))
}

async function checkSpec(
	browser: FrontendBrowser,
	options: CompareOptions,
	context: ExtensionContext,
): Promise<AgentToolResult<unknown>> {
	const spec = await loadSpecFile(requireField(options, 'file'), context.cwd)
	const specimen = await browser.specimen(options.wait_for)
	if (!isJevConfigured())
		return textResult(
			formatSpecReport(
				{
					spec: spec.name ?? 'spec',
					url: specimen.url,
					verdicts: [],
					jevUsed: false,
				},
				specimen,
			),
		)
	return textResult(formatSpecReport(await judgeSpec(spec, specimen)))
}

export function registerCompareTool(
	pi: ExtensionAPI,
	browser: FrontendBrowser,
	config: () => Config,
): void {
	registerFrontendTool(
		pi,
		browser,
		{
			name: 'frontend_compare',
			label: 'Frontend Compare',
			parameters: compareSchema,
			description:
				'Diagnostic comparison, never a pixel gate. mode=capture freezes the open page (or its scope region) with session state - login, persona, demo toggles - into a reusable specimen: components by role with computed styles, geometry, attributes and text. mode=diff compares an implementation side against a baseline side (an HTML prototype, not a mockup image): each side is a captured specimen (captured_a/captured_b) or a cold URL (implementation_url/baseline_url); it lists differing pairs with property-level deltas and, with TYPESAFE_API_KEY, one batched Jev fidelity judgment (named colors, confidence-gated). mode=spec judges the open page against a spec JSON file in one batched Jev call: satisfied/violated per item, anything unproven reported as needing an agent check; without the key it returns the extracted state for your own judgment. This is the default parity evidence (styles, spacing, borders, typography, copy); use frontend_pixels only when exact raster equality was explicitly requested.',
			promptGuidelines: [
				'After a UI change, capture the implementation and the served prototype at the same state (mode=capture on each), then mode=diff; fix every listed style or geometry delta before looking at pixels.',
			],
			execute: async (...args) => {
				const [, options, signal, , context] = args
				if (options.mode === 'capture')
					return captureSpecimen(browser, options)
				if (options.mode === 'spec')
					return checkSpec(browser, options, context)
				return textResult(await runIsoDiff(options, config(), signal))
			},
		},
		options =>
			options.mode === 'diff'
				? config().NAV_TIMEOUT_MS * COLD_URL_SIDES
				: config().NAV_TIMEOUT_MS,
	)
}
