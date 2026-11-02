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
 * Codemode guidelines: codemode-guidelines.ts adds the script output cap, failure handling
 * and the no-validation-inside-a-script rule to the system prompt guidelines at every prompt;
 * script-validation.ts refuses the validation a script issues anyway (parentToolCallId set),
 * so the batch ends before the check runs instead of aborting on its exit code.
 *
 * Loop breaker: repeat-guard.ts refuses a call the model repeats with the same
 * arguments turn after turn, with arguments and output differing only in their
 * numbers, or a tool answering with the same output turn after turn, and
 * escalates on every further repeat (refuse, end the run, abort it);
 * fixed-delay.ts refuses a `sleep` stage between shell commands and
 * idle-command.ts a command that only echoes, assigns or reads the clock. All
 * are announced to the human; a human prompt resets the streaks.
 */
import { isToolCallEventType } from '@earendil-works/pi-coding-agent'

import { isHumanPrompt } from '#lib/human-prompt.ts'
import { runTimedHook } from '#lib/telemetry/hook-timing.ts'

import { registerJobDoneCard } from './bash-job-card.ts'
import { addCodemodeGuidelines } from './codemode-guidelines.ts'
import { FIXED_DELAY_REFUSAL, isFixedDelay } from './fixed-delay.ts'
import { IDLE_COMMAND_REFUSAL, isIdleCommand } from './idle-command.ts'
import { registerManagedBash } from './managed-bash.ts'
import { READ_LEDGER_ENTRY, ReadLedger } from './read-ledger.ts'
import { registerLookupRecovery } from './recovery.ts'
import { RepeatGuard } from './repeat-guard.ts'
import { scriptValidationRefusal } from './script-validation.ts'
import { shellLookupPlan, shellLookupRefusal } from './shell-guard.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
	ToolCallEventResult,
} from '@earendil-works/pi-coding-agent'
import type { LoopStop } from './repeat-guard.ts'

/** host refuses lookups outright; bash refuses only the shapes managed-bash cannot redirect. */
function shellDecision(
	pi: ExtensionAPI,
	toolName: string,
	input: unknown,
	cwd: string,
): { block: true; reason: string } | undefined {
	const command = commandText(input)
	if (isFixedDelay(command))
		return { block: true, reason: FIXED_DELAY_REFUSAL }
	if (isIdleCommand(command))
		return { block: true, reason: IDLE_COMMAND_REFUSAL }
	if (toolName === 'host')
		return shellLookupRefusal(input, pi.getActiveTools())
	const plan = shellLookupPlan(input, pi.getActiveTools(), cwd)
	if (plan?.kind !== 'refuse') return undefined
	return { block: true, reason: plan.reason }
}

function commandText(input: unknown): string {
	if (typeof input === 'object' && input !== null && 'command' in input) {
		const { command } = input
		if (typeof command === 'string') return command
	}
	return JSON.stringify(input) ?? ''
}

function wireReadLedger(pi: ExtensionAPI): void {
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
		runTimedHook('tool_call', 'guard.lookup', async () => {
			if (event.toolName === 'host' || event.toolName === 'bash') {
				const refusal = scriptValidationRefusal(
					commandText(event.input),
					Boolean(event.parentToolCallId),
				)
				if (refusal) return { block: true, reason: refusal }
				return shellDecision(pi, event.toolName, event.input, ctx.cwd)
			}
			if (event.parentToolCallId) return undefined
			if (!isToolCallEventType('read', event)) return undefined
			if (!(await ledger.begin(event.toolCallId, ctx.cwd, event.input)))
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

const STOP_SEVERITY = {
	block: 'warning',
	steer: 'warning',
	terminate: 'error',
	abort: 'error',
} as const

/** The reason reaches the model as the blocked result; the human sees it at the same moment. A steer also reaches the model as a message before its next request, so the run continues. */
function enforceStop(
	pi: ExtensionAPI,
	stop: LoopStop,
	ctx: ExtensionContext,
): ToolCallEventResult {
	if (ctx.hasUI)
		ctx.ui.notify(`Loop guard: ${stop.reason}`, STOP_SEVERITY[stop.level])
	if (stop.level === 'steer')
		pi.sendMessage(
			{
				customType: 'pi-loop-guard-steer',
				content: stop.reason,
				display: false,
			},
			{ deliverAs: 'steer' },
		)
	if (stop.level === 'abort') ctx.abort()
	return {
		block: true,
		reason: stop.reason,
		terminate: stop.level === 'terminate' || stop.level === 'abort',
	}
}

function wireLoopBreaker(pi: ExtensionAPI): void {
	const repeats = new RepeatGuard()
	pi.on('session_start', () => repeats.clear())
	pi.on('session_tree', () => repeats.clear())
	pi.on('input', event => {
		if (isHumanPrompt(event)) repeats.clear()
	})
	pi.on('turn_start', () => repeats.startTurn())
	pi.on('tool_call', (event, ctx) =>
		runTimedHook('tool_call', 'guard.loop', () => {
			if (event.parentToolCallId) return undefined
			const stop = repeats.decide(
				event.toolCallId,
				event.toolName,
				event.input,
			)
			return stop && enforceStop(pi, stop, ctx)
		}),
	)
	pi.on('tool_result', event =>
		runTimedHook('tool_result', 'guard.loop-result', () => {
			if (!event.parentToolCallId)
				repeats.complete(event.toolCallId, event.content)
		}),
	)
}

export default function toolGuard(pi: ExtensionAPI): void {
	registerManagedBash(pi)
	registerJobDoneCard(pi)
	registerLookupRecovery(pi)
	wireReadLedger(pi)
	wireLoopBreaker(pi)
	pi.on('before_agent_start', event =>
		addCodemodeGuidelines(event.systemPromptOptions),
	)
}
