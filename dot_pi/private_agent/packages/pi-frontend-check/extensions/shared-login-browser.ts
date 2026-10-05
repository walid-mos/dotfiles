import { readSharedLogin } from './shared-vault.ts'

import type { AgentToolResult } from '@earendil-works/pi-coding-agent'
import type { Page } from 'playwright-core'

export function redactLoginText(
	text: string,
	secrets: ReadonlySet<string>,
): string {
	let sanitized = text
	for (const secret of secrets) {
		sanitized = sanitized.replaceAll(secret, '[REDACTED]')
		const escaped = JSON.stringify(secret).slice(1, -1)
		if (escaped !== secret)
			sanitized = sanitized.replaceAll(escaped, '[REDACTED]')
		const encoded = encodeURIComponent(secret)
		if (encoded !== secret)
			sanitized = sanitized.replaceAll(encoded, '[REDACTED]')
	}
	return sanitized
}

export function protectLoginResult<Result>(
	toolResult: AgentToolResult<Result>,
	secrets: ReadonlySet<string>,
): AgentToolResult<Result> {
	return {
		...toolResult,
		content: toolResult.content.map(part =>
			part.type === 'text'
				? { ...part, text: redactLoginText(part.text, secrets) }
				: part,
		),
		details: JSON.parse(
			JSON.stringify(
				toolResult.details ?? {},
				(_key, fieldValue: unknown) =>
					typeof fieldValue === 'string'
						? redactLoginText(fieldValue, secrets)
						: fieldValue,
			),
		),
	}
}

/** Serialized into the page: verify the bound origin, fill exactly one visible password field. */
function fillSinglePasswordField({
	boundOrigin,
	password,
}: {
	boundOrigin: string
	password: string
}): boolean {
	if (location.origin !== boundOrigin) return false
	const fields = [
		...document.querySelectorAll<HTMLInputElement>(
			'input[type="password"]',
		),
	].filter(input => {
		const style = getComputedStyle(input)
		return (
			!input.disabled &&
			!input.readOnly &&
			style.visibility !== 'hidden' &&
			style.display !== 'none' &&
			input.getClientRects().length > 0
		)
	})
	if (fields.length !== 1) return false
	const setter = Object.getOwnPropertyDescriptor(
		HTMLInputElement.prototype,
		'value',
	)?.set
	const [field] = fields
	if (!setter || !field) return false
	setter.call(field, password)
	field.dispatchEvent(new Event('input', { bubbles: true }))
	field.dispatchEvent(new Event('change', { bubbles: true }))
	return location.origin === boundOrigin
}

/** A single in-page turn verifies the origin and changes exactly one visible password input. */
export async function fillSharedLogin(
	page: Page,
	handle: string,
	onSecret: (password: string, origin: string) => void,
	signal?: AbortSignal,
): Promise<string> {
	const { origin: pageOrigin } = new URL(page.url())
	const login = await readSharedLogin(handle, signal)
	if (pageOrigin !== login.origin || !login.password)
		throw new Error(
			'Login origin does not match the current page; nothing was filled.',
		)
	onSecret(login.password, login.origin)
	try {
		const filled = await page.evaluate(fillSinglePasswordField, {
			boundOrigin: login.origin,
			password: login.password,
		})
		if (!filled)
			throw new Error(
				'No single visible password field at the bound origin.',
			)
		return `Password filled securely for ${login.origin}; 1 field. Enter the identifier separately, then submit if authorized.`
	} catch {
		// Playwright exceptions can include page values or evaluated arguments.
		throw new Error(
			'Secure login fill failed; nothing sensitive was returned.',
		)
	}
}
