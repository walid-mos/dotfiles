import { failingStepLocator } from './action-failure.ts'

import type { Locator, Page } from 'playwright-core'
import type { ActFailurePhase, StepFailureDiagnosis } from './action-failure.ts'
import type { ActOptions } from './action-schema.ts'

const SCROLL_DISTANCE = 800

function target(page: Page, options: ActOptions): Locator {
	if (!options.target)
		throw new Error(
			`${options.action} requires target (CSS or text=Visible text).`,
		)
	return page.locator(options.target)
}

const actions: Record<
	ActOptions['action'],
	(page: Page, options: ActOptions) => Promise<unknown>
> = {
	click: (page, options) => target(page, options).click(),
	type: async (page, options) => {
		if (typeof options.text !== 'string')
			throw new Error(
				'type requires text (use an empty string to clear).',
			)
		const locator = target(page, options)
		if ((await locator.getAttribute('type'))?.toLowerCase() === 'password')
			throw new Error(
				'Use frontend_vault_fill for password fields; never type a password.',
			)
		await locator.fill(options.text)
	},
	set_files: (page, options) => {
		if (!options.files?.length)
			throw new Error('set_files requires files (absolute local paths).')
		return target(page, options).setInputFiles(options.files)
	},
	press: (page, options) =>
		options.target
			? target(page, options).press(options.key ?? 'Enter')
			: page.keyboard.press(options.key ?? 'Enter'),
	hover: (page, options) => target(page, options).hover(),
	select: async (page, options) => {
		if (typeof options.text !== 'string')
			throw new Error(
				'select requires text (option value or exact label).',
			)
		const locator = target(page, options)
		const hasValue = await locator
			.locator('option')
			.evaluateAll(
				(elements, optionValue) =>
					elements.some(
						element =>
							element.getAttribute('value') === optionValue ||
							(!element.hasAttribute('value') &&
								element.textContent === optionValue),
					),
				options.text,
			)
		await locator.selectOption(
			hasValue ? { value: options.text } : { label: options.text },
		)
	},
	scroll: page => page.mouse.wheel(0, SCROLL_DISTANCE),
	wait_for: (page, options) =>
		target(page, options).waitFor({ state: 'visible' }),
}

export async function actOnPage(
	page: Page,
	options: ActOptions,
): Promise<void> {
	await actions[options.action](page, options)
}

/**
 * Live match count plus URL for the step's failing locator, for the failed
 * report. A page that no longer answers yields undefined; the caller then
 * rethrows the original failure instead of reporting locator diagnostics.
 */
export async function diagnoseFailure(
	page: () => Page,
	options: ActOptions,
	phase: ActFailurePhase,
): Promise<StepFailureDiagnosis | undefined> {
	let current: Page
	try {
		current = page()
	} catch {
		return undefined
	}
	const locator = failingStepLocator(options, phase)
	if (!locator) return { url: current.url() }
	try {
		return {
			url: current.url(),
			matches: await current.locator(locator).count(),
		}
	} catch {
		// Invalid selectors have no count, but the page and batch survive.
		if (current.isClosed()) return undefined
		return { url: current.url() }
	}
}

export async function actWithPopup(
	page: Page,
	options: ActOptions,
): Promise<Page> {
	if (options.action !== 'click')
		throw new Error('popup=true requires action=click.')
	const [popup] = await Promise.all([
		page.waitForEvent('popup'),
		actOnPage(page, options),
	])
	return popup
}
