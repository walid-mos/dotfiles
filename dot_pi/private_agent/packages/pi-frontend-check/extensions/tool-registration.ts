import type {
	ExtensionAPI,
	ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import type { Static, TSchema } from 'typebox'
import type { FrontendBrowser } from './browser.ts'

/**
 * Single queue owner: this wrapper is the only place tool work enters browser.run.
 * Tool execute bodies must not call browser.run again - a nested run enqueues
 * behind the outer operation and self-deadlocks until the operation deadline.
 */
export function registerFrontendTool<Schema extends TSchema>(
	pi: ExtensionAPI,
	browser: FrontendBrowser,
	tool: ToolDefinition<Schema>,
	timeoutMs?: (parameters: Static<Schema>) => number,
): void {
	pi.registerTool({
		...tool,
		execute: async (...args) => {
			const [, parameters, signal] = args
			try {
				const toolResult = await browser.run(
					() => tool.execute(...args),
					signal,
					timeoutMs?.(parameters),
				)
				return browser.protectResult(toolResult)
			} catch (error) {
				// oxlint-disable-next-line preserve-caught-error -- the cause may contain a password or page values
				throw new Error(
					browser.redact(
						error instanceof Error ? error.message : String(error),
					),
				)
			}
		},
	})
}
