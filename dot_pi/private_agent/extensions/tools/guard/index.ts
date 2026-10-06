/**
 * Guard rails on tool calls.
 *
 * Shell lookups: give bash a matching model-facing description; a literal
 * lookup-only shell stage runs through its Pi tool inside managed-bash.ts when
 * the shape maps 1:1 (shell-guard.ts plans it), and is refused otherwise.
 * Transformations and unsupported syntax remain shell work; validation saves
 * logs and exit evidence. recovery.ts appends the evidence a failed edit or
 * read needs for a one-shot retry.
 * managed-bash.ts owns bounded foreground execution; bash-job*.ts own session jobs;
 * bash-job-card.ts renders that runtime's completion follow-up message.
 *
 * Read dedup: block an identical successful `read` of the same file and range
 * while unchanged and its exact source result remains in context. Bounded metadata survives checkpoints/reload;
 * file signatures permit rereading changed files without invalidating other reads.
 * New human input clears the request ledger; navigation restores that branch.
 * Nested calls made by another tool, such as a `codemode` script, keep the shell
 * guard and skip the read ledger: their results never enter the transcript.
 * Codemode budget: codemode-budget.ts adds the script output cap to the system prompt
 * guidelines at every prompt, so the model sizes `@options` before batching reads.
 */
import { isToolCallEventType } from '@earendil-works/pi-coding-agent'

import { isHumanPrompt } from '#lib/human-prompt.ts'
import { runTimedHook } from '#lib/telemetry/hook-timing.ts'

import { registerJobDoneCard } from './bash-job-card.ts'
import { addCodemodeBudgetGuideline } from './codemode-budget.ts'
import { registerManagedBash } from './managed-bash.ts'
import { READ_LEDGER_ENTRY, ReadLedger } from './read-ledger.ts'
import { registerLookupRecovery } from './recovery.ts'
import { shellLookupPlan, shellLookupRefusal } from './shell-guard.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'

/** host refuses lookups outright; bash refuses only the shapes managed-bash cannot redirect. */
function shellDecision(
	pi: ExtensionAPI,
	toolName: string,
	input: unknown,
	cwd: string,
): { block: true; reason: string } | undefined {
	if (toolName === 'host')
		return shellLookupRefusal(input, pi.getActiveTools())
	const plan = shellLookupPlan(input, pi.getActiveTools(), cwd)
	if (plan?.kind !== 'refuse') return undefined
	return { block: true, reason: plan.reason }
}

export default function toolGuard(pi: ExtensionAPI): void {
	registerManagedBash(pi)
	registerJobDoneCard(pi)
	registerLookupRecovery(pi)
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
	pi.on('before_agent_start', event =>
		addCodemodeBudgetGuideline(event.systemPromptOptions),
	)
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
			if (event.toolName === 'host' || event.toolName === 'bash')
				return shellDecision(pi, event.toolName, event.input, ctx.cwd)
			if (event.parentToolCallId) return undefined
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
			if (event.toolName !== 'read' || event.parentToolCallId) return
			ledger.complete(event.toolCallId, event.isError, event.content)
			if (!event.isError)
				pi.appendEntry(READ_LEDGER_ENTRY, ledger.snapshot())
		}),
	)
}
