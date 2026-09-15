/** Measured durations survive reload while their result content remains in memory.
 * Pi replays new result wrappers around the same content array. Weak keys avoid
 * retaining session history; call IDs distinguish tools that share content. */
import { reflectMember } from '../ui/pi-members.ts'

const HISTORY = Symbol.for('pi.renderers.tool-durations.v1')
const previous: unknown = Reflect.get(globalThis, HISTORY)
const durations: WeakMap<object, Map<string, number>> = previous instanceof
WeakMap
	? previous
	: new WeakMap()
Reflect.set(globalThis, HISTORY, durations)

export function rememberToolDuration(
	toolCallId: string,
	toolResult: unknown,
	elapsedMs: number | undefined,
): void {
	const content = reflectMember(toolResult, 'content')
	if (
		!Array.isArray(content) ||
		typeof elapsedMs !== 'number' ||
		!Number.isFinite(elapsedMs)
	)
		return
	const calls = durations.get(content) ?? new Map<string, number>()
	calls.set(toolCallId, elapsedMs)
	durations.set(content, calls)
}

export function recalledToolDuration(
	toolCallId: string,
	toolResult: unknown,
): number | undefined {
	const content = reflectMember(toolResult, 'content')
	if (!Array.isArray(content)) return undefined
	return durations.get(content)?.get(toolCallId)
}
