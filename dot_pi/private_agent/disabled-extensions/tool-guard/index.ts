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
 * `message_end` replaces safe standalone bash/host calls with dedicated tool
 * calls before the agent loop executes them. `tool_call` still blocks guarded
 * commands with no safe translation. Neither shell tool is hidden, and no
 * extra model call is needed.
 * The rules live in blind-wait.ts and shadowed-tools.ts behind policy.ts, the
 * parsing in shell-text.ts, and safe translation in redirect.ts. The
 * dedicated tools are activated at session start wherever pi exposes them,
 * because pi's own prompt sends the model to bash for file operations while
 * they are missing (measured: the `Use bash for file operations like ls, rg,
 * find` guideline disappears as soon as `ls` is active), and refusing a call
 * that names a tool the session does not have is a dead end. Refusals check
 * the live active set, so a restricted child session keeps its grant.
 */
import { guardCommand } from './policy.ts'
import { redirectCommand } from './redirect.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

/** Tools whose command string is judged. */
const GUARDED_TOOLS = new Set(['bash', 'host'])

/** The dedicated tools the rule can only be kept with. */
const DEDICATED_TOOLS = ['grep', 'find', 'ls']

/** The command of a tool call, when it has one. */
function commandOf(input: unknown): string | undefined {
	if (!input || typeof input !== 'object') return undefined
	const command = Reflect.get(input, 'command')
	if (!(typeof command !== 'string')) return command
	return undefined
}

export default function toolGuard(pi: ExtensionAPI): void {
	pi.on('session_start', () => {
		const active = new Set(pi.getActiveTools())
		const exposed = new Set(pi.getAllTools().map(tool => tool.name))
		const missing = DEDICATED_TOOLS.filter(
			name => exposed.has(name) && !active.has(name),
		)
		pi.setActiveTools([...active, ...missing])
	})

	pi.on('message_end', event => {
		if (event.message.role !== 'assistant') return undefined
		const active = pi.getActiveTools()
		let hasRedirect = false
		const content = event.message.content.map(block => {
			if (block.type !== 'toolCall' || !GUARDED_TOOLS.has(block.name))
				return block
			const command = commandOf(block.arguments)
			if (!command || !guardCommand(command, active)) return block
			const redirect = redirectCommand(command, active)
			if (!redirect) return block
			hasRedirect = true
			return {
				...block,
				name: redirect.toolName,
				arguments: redirect.input,
			}
		})
		if (!hasRedirect) return undefined
		return { message: { ...event.message, content } }
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
