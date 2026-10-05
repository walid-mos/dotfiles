import type {
	AgentToolResult,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { FrontendBrowser } from './browser.ts'

export function textResult(text: string): AgentToolResult<unknown> {
	return { content: [{ type: 'text' as const, text }], details: {} }
}

export async function withScreenshot(
	browser: FrontendBrowser,
	text: string,
	options: { shouldCapture: boolean; context: ExtensionContext },
): Promise<AgentToolResult<unknown>> {
	if (!options.shouldCapture) return textResult(text)
	const { context } = options
	if (context.model && !context.model.input.includes('image')) {
		return textResult(
			`${text}\nScreenshot omitted: the selected model does not accept images.`,
		)
	}
	try {
		return {
			content: [...textResult(text).content, await browser.screenshot()],
			details: {},
		}
	} catch (error) {
		return textResult(
			`${text}\nAction completed, but screenshot failed: ${error instanceof Error ? error.message : String(error)}. Do not repeat a state-changing action just to retry its screenshot.`,
		)
	}
}
