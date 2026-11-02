/** Keep Pi's process execution and validation evidence behind a bounded foreground wait. */
import { createBashToolDefinition } from '@earendil-works/pi-coding-agent'

import { bashOperations } from '#lib/runtime/pi-operations.ts'
import { runtimeFor } from '#lib/runtime/runtime.ts'
import { nestedOptions, nestedText } from '#lib/tools/nested.ts'

import {
	FOREGROUND_MS,
	MAX_FOREGROUND_MS,
	managedBashSchema,
} from './bash-job-schema.ts'
import { BashJobs } from './bash-jobs.ts'
import { executeWithEvidence } from './command-evidence.ts'
import {
	MAX_IDENTICAL_CALLS,
	MAX_IDENTICAL_RESULTS,
	MAX_SIMILAR_CALLS,
} from './repeat-guard.ts'
import { shellLookupPlan } from './shell-guard.ts'

import type {
	ExtensionAPI,
	ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import type { BashJob } from './bash-job.ts'
import type { LookupPlan } from './shell-guard.ts'

const BASH_PURPOSE =
	'Run builds, tests, git, and commands that transform or store results.'

function notifyCompletion(pi: ExtensionAPI, job: BashJob): void {
	if (job.snapshot().status === 'cancelled') return
	pi.sendMessage(
		{
			customType: 'pi-bash-job-complete',
			content: `Background command finished: ${JSON.stringify(job.snapshot())}\n${job.preview()}\nUse bash action=status with this jobId for details. Do not rerun the command to recover output.`,
			display: true,
		},
		{ triggerTurn: true, deliverAs: 'steer' },
	)
}

type ManagedArguments = Parameters<
	ToolDefinition<typeof managedBashSchema, unknown>['execute']
>
type ManagedResult = ReturnType<
	ToolDefinition<typeof managedBashSchema, unknown>['execute']
>
/** Positions of `signal` and `ctx` in a tool's execute arguments. */
const SIGNAL_ARGUMENT = 2
const CONTEXT_ARGUMENT = 4

/** A lookup typed into bash runs through its owning tool: same result, no lost round trip. */
async function redirectLookup(
	plan: Extract<LookupPlan, { kind: 'redirect' }>,
	ctx: ManagedArguments[typeof CONTEXT_ARGUMENT],
	signal: ManagedArguments[typeof SIGNAL_ARGUMENT],
): ManagedResult {
	const nested = await ctx.executeTool(
		plan.tool,
		plan.args,
		nestedOptions(signal),
	)
	return {
		content: [
			{ type: 'text', text: `${plan.note}\n${nestedText(nested)}` },
		],
		details: { redirectedTo: plan.tool, args: plan.args },
		isError: nested.isError,
	}
}

async function executeManagedBash(
	pi: ExtensionAPI,
	jobs: BashJobs,
	bash: ReturnType<typeof createBashToolDefinition>,
	args: ManagedArguments,
): ReturnType<ToolDefinition<typeof managedBashSchema, unknown>['execute']> {
	const [id, input, signal, update, ctx] = args
	if (input.action && input.action !== 'run')
		return jobs.control(input, signal)
	const plan = shellLookupPlan(input, pi.getActiveTools(), ctx.cwd)
	if (plan?.kind === 'redirect') return redirectLookup(plan, ctx, signal)
	const sessionId = ctx.sessionManager.getSessionId()
	const isCurrent = (): boolean =>
		jobs.isOpen() && ctx.sessionManager.getSessionId() === sessionId
	const commandInput = { ...input, command: input.command ?? '' }
	return jobs.run(input, {
		cwd: ctx.cwd,
		signal,
		update,
		execute: (jobSignal, jobUpdate) =>
			executeWithEvidence(
				pi,
				bash,
				[id, commandInput, jobSignal, jobUpdate, ctx],
				isCurrent,
			),
		onComplete: job => {
			if (isCurrent()) notifyCompletion(pi, job)
		},
	})
}

function managedTool(
	pi: ExtensionAPI,
	jobs: BashJobs,
): ToolDefinition<typeof managedBashSchema, unknown> {
	const runtime = runtimeFor(process.cwd())
	const bash = createBashToolDefinition(process.cwd(), {
		...(runtime.isRemote && { operations: bashOperations(runtime) }),
	})
	return {
		name: bash.name,
		label: bash.label,
		parameters: managedBashSchema,
		description: `${BASH_PURPOSE} Runs in the session cwd: never prefix \`cd <cwd> &&\`. Use read/grep/find/ls (or lookup for several at once) for file lookups; a plain cat/ls/grep/find/head/sed -n typed here is executed through that tool automatically. Run keeps this call open up to ${FOREGROUND_MS}ms (foregroundMs lengthens that, up to ${MAX_FOREGROUND_MS}ms; an open call costs no tokens) and returns the result, or a running jobId when the command outlives the window. background:true returns at once (servers). A job notifies this session when it completes: there is no wait action, never poll status; do independent work or end this turn and let the completion notification resume it. Manage jobs through this same tool with action:list/status/stop; status is one progress read per running job, stop cancels the process group. In one-shot sessions, finish or stop owned jobs before the final reply. Cancellation never restarts the agent. Running does not mean ready or successful. Owned jobs stop on reload, session replacement and exit. Explicit shell backgrounding or daemonization escapes job ownership; use background:true instead. Native output truncation and validation logs are retained.`,
		promptSnippet: BASH_PURPOSE,
		promptGuidelines: [
			`Validation commands save complete logs and exit evidence. Read those logs instead of rerunning to change head/tail/grep output. The same command is refused after ${MAX_IDENTICAL_CALLS} consecutive turns, a command whose arguments and output differ only in numbers after ${MAX_SIMILAR_CALLS}, and any command after ${MAX_IDENTICAL_RESULTS} consecutive turns of identical output; a sleep between commands and a command that only echoes, assigns or reads the clock are refused outright. Every call resends the whole conversation as a paid request: never fill a wait with calls. Change hypothesis or end the turn instead.`,
			'A command that outlives the foreground window becomes an owned job and notifies this session on completion; lengthen foregroundMs for a long command whose result this turn needs. Use background:true for servers instead of nohup, setsid or shell backgrounding. Reuse the returned jobId; verify readiness separately. In one-shot sessions, finish or stop owned jobs before the final reply.',
		],
		execute: (...args) => executeManagedBash(pi, jobs, bash, args),
	}
}

export function registerManagedBash(pi: ExtensionAPI): void {
	const jobs = new BashJobs()
	pi.on('session_shutdown', () => jobs.close())
	pi.registerTool(managedTool(pi, jobs))
	pi.registerCommand('bash-jobs', {
		description:
			"List this session's shell jobs, or stop one: /bash-jobs stop <jobId>",
		handler: async (args, ctx) => {
			const [action, jobId, extra] = args.trim().split(/\s+/)
			if (extra || (action && (action !== 'stop' || !jobId)))
				throw new Error('Usage: /bash-jobs or /bash-jobs stop <jobId>')
			const report = await jobs.control(
				action && jobId
					? { action: 'stop', jobId }
					: { action: 'list' },
				ctx.signal,
			)
			ctx.ui.notify(
				report.content
					.flatMap(part => (part.type === 'text' ? [part.text] : []))
					.join('\n'),
				'info',
			)
		},
	})
}
