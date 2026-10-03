/** Keep Pi's process execution and validation evidence behind a bounded foreground wait. */
import { createBashToolDefinition } from '@earendil-works/pi-coding-agent'

import { FOREGROUND_MS, managedBashSchema } from './bash-job-schema.ts'
import { BashJobs } from './bash-jobs.ts'
import { executeWithEvidence } from './command-evidence.ts'

import type {
	ExtensionAPI,
	ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import type { BashJob } from './bash-job.ts'

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
		{ triggerTurn: true, deliverAs: 'followUp' },
	)
}

type ManagedArguments = Parameters<
	ToolDefinition<typeof managedBashSchema, unknown>['execute']
>

async function executeManagedBash(
	pi: ExtensionAPI,
	jobs: BashJobs,
	bash: ReturnType<typeof createBashToolDefinition>,
	args: ManagedArguments,
): ReturnType<ToolDefinition<typeof managedBashSchema, unknown>['execute']> {
	const [id, input, signal, update, ctx] = args
	if (input.action && input.action !== 'run')
		return jobs.control(input, signal)
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
	const bash = createBashToolDefinition(process.cwd(), {
		spawnHook: context => ({
			...context,
			env: { ...context.env, HERDR_ENV: undefined },
		}),
	})
	return {
		name: bash.name,
		label: bash.label,
		parameters: managedBashSchema,
		description: `${BASH_PURPOSE} Use read/grep/find/ls for file lookups. Run returns within ${FOREGROUND_MS}ms with either the result or a running jobId, even when timeout is omitted or large. Use yieldMs:0 for servers. Manage jobs through this same tool with action:list/status/wait/stop; wait is bounded, stop cancels the process group. Completion notifies this session; cancellation never restarts the agent. Running does not mean ready or successful. Owned jobs stop on reload, session replacement and exit. Explicit shell backgrounding or daemonization escapes job ownership; use yieldMs:0 instead. Native output truncation and validation logs are retained.`,
		promptSnippet: BASH_PURPOSE,
		promptGuidelines: [
			'Validation commands save complete logs and exit evidence. Read those logs instead of rerunning to change head/tail/grep output. Repeats still execute; name a bounded flaky-run purpose or changed hypothesis.',
			'Bash automatically yields long commands as owned jobs. Use yieldMs:0 for servers instead of nohup, setsid or shell backgrounding. Reuse the returned jobId; verify readiness separately. In one-shot sessions, finish or stop owned jobs before the final reply.',
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
