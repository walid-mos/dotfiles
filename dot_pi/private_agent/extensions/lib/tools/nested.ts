/** Helpers for tools that run other tools through `ctx.executeTool`. */
import type {
	ExecuteToolOptions,
	ExtensionToolContext,
} from '@earendil-works/pi-coding-agent'

type NestedOutcome = Awaited<ReturnType<ExtensionToolContext['executeTool']>>

/** `exactOptionalPropertyTypes`: an absent signal must stay absent, not `undefined`. */
export function nestedOptions(
	signal: AbortSignal | undefined,
): ExecuteToolOptions {
	if (!signal) return {}
	return { signal }
}

/** The text parts of a nested result, the way the model would have seen them. */
export function nestedText(outcome: NestedOutcome): string {
	return outcome.result.content
		.flatMap(part => (part.type === 'text' ? [part.text] : []))
		.join('\n')
}
