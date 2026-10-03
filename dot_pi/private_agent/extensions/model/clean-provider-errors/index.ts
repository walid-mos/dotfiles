/**
 * clean-provider-errors - collapse HTML gateway error pages in provider
 * errors to one readable line.
 *
 * When a model provider sits behind a reverse proxy, gateway failures
 * (502/504) return the proxy's static HTML error page instead of a JSON API
 * error, and pi-ai embeds that body verbatim into the assistant error
 * message, flooding the transcript with markup. This extension intercepts
 * the finalized assistant message (`message_end`) and replaces any embedded
 * HTML error page with its `<title>` plus a short hint that the failure is
 * server-side (provider outage) and not caused by the prompt. See
 * `sanitize.ts` for the exact transformation; it is unit-tested in
 * `../tests/clean-provider-errors.test.ts`.
 */

import { sanitizeProviderError } from './sanitize.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export default function cleanProviderErrors(pi: ExtensionAPI): void {
	pi.on('message_end', async event => {
		const { message } = event
		if (
			!('errorMessage' in message) ||
			typeof message.errorMessage !== 'string' ||
			!message.errorMessage.length
		) {
			return
		}
		const { text, hadHtmlPage } = sanitizeProviderError(
			message.errorMessage,
		)
		if (!hadHtmlPage) {
			return
		}
		return { message: { ...message, errorMessage: text } }
	})
}
