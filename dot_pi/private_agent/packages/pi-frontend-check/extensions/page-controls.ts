import { boundedText } from './report.ts'

import type { Page } from 'playwright-core'

const MAX_CONTROLS = 40
const MAX_CONTROL_BYTES = 5000
const MAX_FAILURE_BYTES = 400
const MAX_TEXT_SELECTOR_CHARS = 80
const DIALOG_SELECTOR = [
	'dialog[open]',
	'[role="dialog"]',
	'[aria-modal="true"]',
	'[role="menu"]',
	'[role="listbox"]',
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
	'[role="menuitem"]',
	'[role="menuitemradio"]',
	'[role="menuitemcheckbox"]',
	'[role="option"]',
	'[role="combobox"]',
	'[role="switch"]',
	'[role="status"]',
	'[role="alert"]',
	'[aria-label][role="img"]',
].join(',')

export type ControlSnapshot = {
	scope: string
	/** A dialog, menu or listbox is open: its controls are what the next step needs. */
	isOverlay: boolean
	visibleCount: number
	controls: {
		tag: string
		role?: string
		type?: string
		/** A strict Playwright locator that matches exactly this element; absent when none is unique. */
		selector?: string
		label: string
		disabled?: true
	}[]
}

/**
 * Serialized into the page: no host closures, input values or storage. Each
 * control carries one copyable strict selector, verified unique page-wide
 * (Playwright strict mode counts hidden matches too), so the model copies it
 * instead of guessing an ambiguous `text=` locator.
 */
// oxlint-disable-next-line max-lines-per-function -- self-contained by serialization constraint
function collectControls(options: {
	limit: number
	dialog: string
	selector: string
	maxTextChars: number
}): ControlSnapshot {
	// Helpers stay inside the function Playwright serializes.
	// oxlint-disable-next-line unicorn/consistent-function-scoping
	const isVisible = (element: Element): boolean =>
		element.checkVisibility({ visibilityProperty: true })
	const dialogs = [...document.querySelectorAll(options.dialog)].filter(
		isVisible,
	)
	const scope = dialogs.at(-1) ?? document.body
	const nodes = [...scope.querySelectorAll(options.selector)].filter(
		isVisible,
	)
	// oxlint-disable-next-line unicorn/consistent-function-scoping
	const normalize = (raw: string | null | undefined): string =>
		(raw ?? '').replace(/\s+/g, ' ').trim()
	// oxlint-disable-next-line unicorn/consistent-function-scoping
	const isUniqueCss = (css: string): boolean => {
		try {
			return document.querySelectorAll(css).length === 1
		} catch {
			return false
		}
	}
	const attributeSelector = (
		element: Element,
		attribute: string,
	): string | undefined => {
		const attributeValue = element.getAttribute(attribute)
		if (!attributeValue) return undefined
		const css = `${element.tagName.toLowerCase()}[${attribute}=${JSON.stringify(attributeValue)}]`
		if (!isUniqueCss(css)) return undefined
		return css
	}
	const textSelector = (
		element: Element,
		text: string,
	): string | undefined => {
		if (!text || text.length > options.maxTextChars) return undefined
		const role = element.getAttribute('role')
		const base = role
			? `[role=${JSON.stringify(role)}]`
			: element.tagName.toLowerCase()
		const sameText = [...document.querySelectorAll(base)].filter(
			candidate => normalize(candidate.textContent) === text,
		)
		if (sameText.length !== 1) return undefined
		return `${base}:text-is(${JSON.stringify(text)})`
	}
	const selectorFor = (
		element: Element,
		text: string,
	): string | undefined => {
		const id = element.getAttribute('id')
		if (id && isUniqueCss(`#${CSS.escape(id)}`)) return `#${CSS.escape(id)}`
		return (
			attributeSelector(element, 'aria-label') ??
			attributeSelector(element, 'name') ??
			attributeSelector(element, 'placeholder') ??
			attributeSelector(element, 'data-testid') ??
			textSelector(element, text)
		)
	}
	return {
		scope: dialogs.length
			? `visible ${scope.getAttribute('role') ?? 'dialog'}`
			: 'page',
		isOverlay: dialogs.length > 0,
		visibleCount: nodes.length,
		controls: nodes.slice(0, options.limit).map(element => {
			const isField =
				element instanceof HTMLInputElement ||
				element instanceof HTMLSelectElement ||
				element instanceof HTMLTextAreaElement
			const fieldLabels = isField
				? [...(element.labels ?? [])]
						.map(label => label.textContent)
						.join(' ')
				: ''
			const text = isField ? '' : normalize(element.textContent)
			const control: ControlSnapshot['controls'][number] = {
				tag: element.tagName.toLowerCase(),
				label: normalize(
					element.getAttribute('aria-label') ||
						fieldLabels ||
						text ||
						element.getAttribute('placeholder') ||
						element.getAttribute('title'),
				),
			}
			const role = element.getAttribute('role')
			const type = element.getAttribute('type')
			const selector = selectorFor(element, text)
			if (role) control.role = role
			if (type) control.type = type
			if (selector) control.selector = selector
			if (element.matches(':disabled,[aria-disabled="true"]'))
				control.disabled = true
			return control
		}),
	}
}

/** The current visible controls, or the bounded failure message when the page cannot answer. */
export async function snapshotControls(
	page: Page,
): Promise<ControlSnapshot | string> {
	try {
		return await page.evaluate(collectControls, {
			limit: MAX_CONTROLS,
			dialog: DIALOG_SELECTOR,
			selector: CONTROL_SELECTOR,
			maxTextChars: MAX_TEXT_SELECTOR_CHARS,
		})
	} catch (error) {
		// Observation failure must not cause replay of an already-applied action.
		return error instanceof Error ? error.message : String(error)
	}
}

/** Navigation hints only, never coverage or readiness assertions. */
export function formatControls(
	snapshot: ControlSnapshot | string,
	redact: (text: string) => string,
): string {
	if (typeof snapshot === 'string')
		return `Visible controls unavailable: ${boundedText(redact(snapshot), MAX_FAILURE_BYTES)}. Inspect the preserved page; do not replay completed actions.`
	// Redact complete labels before clipping; do not expose a partial secret.
	return `Visible controls (copy "selector" verbatim as target; bounded hints, not coverage or readiness proof):\n${boundedText(redact(JSON.stringify(snapshot)), MAX_CONTROL_BYTES)}`
}

export async function visibleControls(
	page: Page,
	redact: (text: string) => string,
): Promise<string> {
	return formatControls(await snapshotControls(page), redact)
}
