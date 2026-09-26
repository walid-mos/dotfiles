/**
 * Guard rails on tool calls.
 *
 * Shell lookups: refuse obvious standalone shell file lookups when their Pi
 * tool is active. Compound shell commands and commands that transform data
 * remain shell work.
 *
 * Read dedup: block an identical successful `read` of the same file and range
 * while the file is unchanged. The ledger clears on new user input,
 * compaction, navigation, and any tool that might mutate local files.
 */
import { isToolCallEventType } from '@earendil-works/pi-coding-agent'

import { ReadLedger } from './read-ledger.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

const OWNERS = new Map([
	['cat', 'read'],
	['grep', 'grep'],
	['rg', 'grep'],
	['find', 'find'],
	['ls', 'ls'],
])
const READ_ONLY_TOOLS = new Set(['read', 'grep', 'find', 'ls'])
const SHELL_SYNTAX = /[|;&<>$`\n]/
const SUMMARY_FLAG =
	/(?:^|\s)(?:-c|-l|--count|--count-matches|--files-with-matches)(?:\s|$)/
const SHELL_ONLY = new Map([
	['cat', /^cat -$/],
	['ls', /\s-/],
	['grep', SUMMARY_FLAG],
	['rg', SUMMARY_FLAG],
	['find', /\s-(?:exec|execdir|delete|ok|okdir)\b/],
])

function commandOf(input: unknown): string {
	if (!input || typeof input !== 'object') return ''
	const command = Reflect.get(input, 'command')
	return typeof command === 'string' ? command.trim() : ''
}

function ownerOf(
	command: string,
	activeTools: readonly string[],
): string | undefined {
	if (SHELL_SYNTAX.test(command)) return undefined
	const name = /^(\w+)(?:\s|$)/.exec(command)?.[1]
	if (!name) return undefined
	const owner = OWNERS.get(name)
	if (!owner || !activeTools.includes(owner)) return undefined
	if (SHELL_ONLY.get(name)?.test(command)) return undefined
	return owner
}

export default function toolGuard(pi: ExtensionAPI): void {
	const ledger = new ReadLedger()

	pi.on('session_start', () => ledger.clear())
	pi.on('input', () => ledger.clear())
	pi.on('session_before_compact', () => ledger.clear())
	pi.on('session_tree', () => ledger.clear())

	pi.on('tool_call', (event, ctx) => {
		if (['bash', 'host'].includes(event.toolName)) {
			const command = commandOf(event.input)
			const owner = ownerOf(command, pi.getActiveTools())
			if (!owner) return undefined
			return {
				block: true,
				reason: `Use the active ${owner} tool for this file lookup. Use bash for commands that transform or store results.`,
			}
		}
		if (!READ_ONLY_TOOLS.has(event.toolName)) {
			ledger.clear()
			return undefined
		}
		if (!isToolCallEventType('read', event)) return undefined
		if (!ledger.begin(event.toolCallId, ctx.cwd, event.input))
			return undefined
		return {
			block: true,
			reason: `Already read ${event.input.path} with the same range while unchanged. Use its previous result or request a different range.`,
		}
	})

	pi.on('tool_result', event => {
		if (event.toolName !== 'read') return
		ledger.complete(event.toolCallId, event.isError)
	})
}
