import {
	FOREGROUND_MS,
	MAX_FINISHED_JOBS,
	MAX_RUNNING_JOBS,
	STOP_GRACE_MS,
} from './bash-job-schema.ts'
import { waitForJob } from './bash-job-wait.ts'
import { BashJob } from './bash-job.ts'

import type { AgentToolResult } from '@earendil-works/pi-coding-agent'
import type { ManagedBashInput } from './bash-job-schema.ts'
import type { BashJobOptions } from './bash-job.ts'

type LaunchOptions = Omit<BashJobOptions, 'command'> & {
	signal: AbortSignal | undefined
}

/** Session owner. Capacity refuses before spawn; it never falls back to an unbounded wait. */
export class BashJobs {
	readonly #jobs = new Map<string, BashJob>()
	#isClosed = false

	isOpen(): boolean {
		return !this.#isClosed
	}

	async run(
		input: ManagedBashInput,
		options: LaunchOptions,
	): Promise<AgentToolResult<unknown>> {
		this.#checkRun(input, options.signal)
		const job = new BashJob({
			...options,
			command: input.command ?? '',
			onComplete: completed => {
				this.#prune()
				if (!this.#isClosed) options.onComplete(completed)
			},
		})
		this.#jobs.set(job.id, job)
		const outcome = await waitForJob(
			job.settled,
			input.yieldMs ?? FOREGROUND_MS,
			options.signal,
		)
		if (outcome === 'aborted') job.stop()
		if (!job.isRunning()) {
			this.#jobs.delete(job.id)
			return job.result()
		}
		job.promote()
		return this.#report(job, outcome)
	}

	#checkRun(input: ManagedBashInput, signal?: AbortSignal): void {
		this.#prune()
		if (signal?.aborted || this.#isClosed)
			throw new Error('Command cancelled before starting.')
		if (!input.command?.trim() || input.jobId)
			throw new Error(
				'Run requires command and no jobId. Use action status/wait/stop to manage an existing job.',
			)
		if (
			[...this.#jobs.values()].filter(job => job.isRunning()).length >=
			MAX_RUNNING_JOBS
		)
			throw new Error(
				`At capacity (${MAX_RUNNING_JOBS} running commands). List and stop an owned job before starting another; no command was started.`,
			)
	}

	async control(
		input: ManagedBashInput,
		signal?: AbortSignal,
	): Promise<AgentToolResult> {
		if ('command' in input || 'timeout' in input || 'yieldMs' in input)
			throw new Error(
				'Job controls take only action and jobId; omit command, timeout and yieldMs.',
			)
		if (input.action === 'list') {
			if (input.jobId) throw new Error('List takes no jobId.')
			const jobs = [...this.#jobs.values()]
				.filter(job => job.isBackground())
				.map(job => job.snapshot())
			return {
				content: [{ type: 'text', text: JSON.stringify(jobs) }],
				details: { jobs },
			}
		}
		const job = input.jobId ? this.#jobs.get(input.jobId) : undefined
		if (!job?.isBackground())
			throw new Error(
				'Unknown job in this live session. Use bash action=list. Jobs stop on reload, session replacement or exit; saved receipts are evidence, not live handles.',
			)
		if (input.action === 'stop') job.stop()
		const waitMs = input.action === 'stop' ? STOP_GRACE_MS : FOREGROUND_MS
		const outcome =
			job.isRunning() && ['stop', 'wait'].includes(input.action ?? '')
				? await waitForJob(job.settled, waitMs, signal)
				: undefined
		return this.#report(job, outcome)
	}

	#report(job: BashJob, outcome?: string): AgentToolResult {
		const snapshot = job.snapshot()
		const guidance = job.isRunning()
			? 'Command is still running, not successful or ready. Do not rerun it. Use bash action=status/wait/stop with this jobId; check readiness separately. Completion notifies this session unless cancelled. Jobs stop on reload, session replacement or exit.'
			: 'Command finished. Receipts write asynchronously; check receiptPath/persistenceError and read the receipt or full-output/validation log before rerunning.'
		return {
			content: [
				{
					type: 'text',
					text: `${JSON.stringify(snapshot)}\n${guidance}\n${job.preview()}`,
				},
			],
			details: snapshot,
			isError:
				outcome === 'aborted' ||
				['failed', 'cancelled'].includes(snapshot.status),
		}
	}

	#prune(): void {
		const finished = [...this.#jobs.values()]
			.filter(job => !job.isRunning())
			.toSorted(
				(a, b) =>
					(a.snapshot().finishedAt ?? 0) -
					(b.snapshot().finishedAt ?? 0),
			)
		for (const job of finished.slice(
			0,
			Math.max(0, finished.length - MAX_FINISHED_JOBS),
		))
			this.#jobs.delete(job.id)
	}

	async #settleClosedJobs(settled: AbortController): Promise<void> {
		await Promise.allSettled(
			[...this.#jobs.values()].map(job => job.completion),
		)
		settled.abort()
	}

	async close(): Promise<void> {
		this.#isClosed = true
		for (const job of this.#jobs.values()) job.stop()
		const settled = new AbortController()
		void this.#settleClosedJobs(settled)
		await waitForJob(settled.signal, STOP_GRACE_MS)
	}
}
