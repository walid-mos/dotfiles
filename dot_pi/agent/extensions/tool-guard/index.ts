/**
 * tool-guard - keep tool calls honest.
 *
 * Two rules, both paid for by the session logs:
 *  1. No host-level `sleep` as a wait (195 calls had already burned 192
 *     minutes), so a stalled-looking call becomes an explicit detach plus a
 *     real signal instead.
 *  2. No bash stage whose work a dedicated tool owns (`read`, `grep`, `find`,
 *     `ls`), wherever it sits: a pipe, a redirect or a `head`/`tail` wrapper
 *     does not change what the call is, so file content reaches the context
 *     through the tool that caps, renders and tracks it.
 *
 * `tool_call` is the right hook: it blocks before execution and covers the
 * `bash` and `host` tools alike, without touching either registration. The
 * rules live in blind-wait.ts and shadowed-tools.ts behind policy.ts, the
 * parsing in shell-text.ts. Interactive sessions
 * add the discovery built-ins without replacing extension tools. Refusals
 * check the live active set, including in restricted child sessions.
 */
import { guardCommand } from './policy.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

/** Tools whose command string is judged. */
const GUARDED_TOOLS = new Set(['bash', 'host'])

/** The command of a tool call, when it has one. */
function commandOf(input: unknown): string | undefined {
	if (!input || typeof input !== 'object') return undefined
	const command = Reflect.get(input, 'command')
	if (typeof command !== 'string') return undefined
	return command
}

export default function toolGuard(pi: ExtensionAPI): void {
	pi.on('session_start', (_event, ctx) => {
		if (ctx.mode !== 'tui') return
		pi.setActiveTools([
			...new Set([...pi.getActiveTools(), 'grep', 'find', 'ls']),
		])
	})

	pi.on('tool_call', event => {
		if (!GUARDED_TOOLS.has(event.toolName)) return undefined
		const command = commandOf(event.input)
		if (!command) return undefined
		const reason = guardCommand(command, pi.getActiveTools())
		if (!reason) return undefined
		return { block: true, reason }
	})
}
