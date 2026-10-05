import { boundedText } from './report.ts'

import type { Page } from 'playwright-core'

const MAX_CONTROLS = 40
const MAX_CONTROL_BYTES = 5000
const MAX_FAILURE_BYTES = 400
const DIALOG_SELECTOR = [
	'dialog[open]',
	'[role="dialog"]',
	'[aria-modal="true"]',
].join(',')
const CONTROL_SELECTOR = [
	'button',
	'a[href]',
	'input:not([type="hidden"])',
	'select',
	'textarea',
	'h1',
	'h2',
	'h3',
	'[role="button"]',
	'[role="tab"]',
	'[role="checkbox"]',
	'[role="radio"]',
	'[role="status"]',
	'[role="alert"]',
	'[aria-label][role="img"]',
].join(',')

type ControlSnapshot = {
	scope: string
	visibleCount: number
	controls: {
		tag: string
		attributes: Record<string, string | null>
		label: string | null | undefined
		disabled: boolean
	}[]
}

/** Serialized into the page: no host closures, input values or storage. */
function collectControls(options: {
	limit: number
	dialog: string
	selector: string
}): ControlSnapshot {
	const dialogs = [...document.querySelectorAll(options.dialog)].filter(
		element => element.checkVisibility({ visibilityProperty: true }),
	)
	const scope = dialogs.at(-1) ?? document.body
	const nodes = [...scope.querySelectorAll(options.selector)].filter(
		element => element.checkVisibility({ visibilityProperty: true }),
	)
	return {
		scope: dialogs.length ? 'visible dialog' : 'page',
		visibleCount: nodes.length,
		controls: nodes.slice(0, options.limit).map(element => {
			const isField =
				element instanceof HTMLInputElement ||
				element instanceof HTMLSelectElement ||
				element instanceof HTMLTextAreaElement
			const labels = isField
				? [...(element.labels ?? [])]
						.map(label => label.textContent)
						.join(' ')
				: ''
			return {
				tag: element.tagName.toLowerCase(),
				attributes: Object.fromEntries(
					[
						'id',
						'role',
						'name',
						'aria-label',
						'placeholder',
						'type',
						'title',
					]
						.map(name => [name, element.getAttribute(name)])
						.filter(([, value]) => value),
				),
				label:
					element.getAttribute('aria-label') ||
					labels ||
					(isField ? '' : element.textContent?.trim()) ||
					element.getAttribute('title'),
				disabled: element.matches(':disabled,[aria-disabled="true"]'),
			}
		}),
	}
}

/** Navigation hints only, never coverage or readiness assertions. */
export async function visibleControls(
	page: Page,
	redact: (text: string) => string,
): Promise<string> {
	try {
		const snapshot = await page.evaluate(collectControls, {
			limit: MAX_CONTROLS,
			dialog: DIALOG_SELECTOR,
			selector: CONTROL_SELECTOR,
		})
		// Redact complete labels before clipping; do not expose a partial secret.
		return `Visible controls (bounded hints; not coverage or readiness proof):\n${boundedText(redact(JSON.stringify(snapshot)), MAX_CONTROL_BYTES)}`
	} catch (error) {
		// Observation failure must not cause replay of an already-applied action.
		const message = error instanceof Error ? error.message : String(error)
		return `Visible controls unavailable: ${boundedText(redact(message), MAX_FAILURE_BYTES)}. Inspect the preserved page; do not replay completed actions.`
	}
}
