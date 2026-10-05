/**
 * Guard rails on tool calls.
 *
 * Shell lookups: give bash a matching model-facing description, then refuse
 * literal lookup-only shell stages when their Pi tool is active. Transformations
 * and unsupported syntax remain shell work; validation saves logs and exit evidence.
 * managed-bash.ts owns bounded foreground execution; bash-job*.ts own session jobs;
 * bash-job-card.ts renders that runtime's completion follow-up message.
 *
 * Read dedup: block an identical successful `read` of the same file and range
 * while unchanged and its exact source result remains in context. Bounded metadata survives checkpoints/reload;
 * file signatures permit rereading changed files without invalidating other reads.
 * New human input clears the request ledger; navigation restores that branch.
 */
import { isToolCallEventType } from '@earendil-works/pi-coding-agent'

import { isHumanPrompt } from '#lib/human-prompt.ts'
import { runTimedHook } from '#lib/telemetry/hook-timing.ts'

import { registerJobDoneCard } from './bash-job-card.ts'
import { registerManagedBash } from './managed-bash.ts'
import { READ_LEDGER_ENTRY, ReadLedger } from './read-ledger.ts'
import { shellLookupRefusal } from './shell-guard.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'

export default function toolGuard(pi: ExtensionAPI): void {
	registerManagedBash(pi)
	registerJobDoneCard(pi)
	const ledger = new ReadLedger()
	const restore = (ctx: ExtensionContext): void => {
		const saved = ctx.sessionManager
			.getBranch()
			.findLast(
				entry =>
					entry.type === 'custom' &&
					entry.customType === READ_LEDGER_ENTRY,
			)
		ledger.restore(saved?.type === 'custom' ? saved.data : undefined)
	}
	pi.on('session_start', (_event, ctx) => restore(ctx))
	pi.on('session_tree', (_event, ctx) => restore(ctx))
	pi.on('context', event => ledger.observe(event.messages))
	pi.on('input', event => {
		if (!isHumanPrompt(event)) return
		ledger.clear()
		pi.appendEntry(READ_LEDGER_ENTRY, ledger.snapshot())
	})

	pi.on('tool_call', (event, ctx) =>
		runTimedHook('tool_call', 'guard.lookup', () => {
			if (['bash', 'host'].includes(event.toolName))
				return shellLookupRefusal(event.input, pi.getActiveTools())
			if (!isToolCallEventType('read', event)) return undefined
			if (!ledger.begin(event.toolCallId, ctx.cwd, event.input))
				return undefined
			return {
				block: true,
				reason: `Already read ${event.input.path} with the same range while unchanged; its exact successful result remains in the current context. Reuse that result. A result removed or replaced by a checkpoint permits rereading.`,
			}
		}),
	)

	pi.on('tool_result', event =>
		runTimedHook('tool_result', 'guard.read-result', () => {
			if (event.toolName !== 'read') return
			ledger.complete(event.toolCallId, event.isError, event.content)
			if (!event.isError)
				pi.appendEntry(READ_LEDGER_ENTRY, ledger.snapshot())
		}),
	)
}
