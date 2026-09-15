/** Row-local execution timing. Replay has no fabricated duration; settled clocks never restart. */
import type { ActivityPhase } from '../ui/activity-line.ts'

export interface ToolProgress {
	isStarted: boolean
	isPartial: boolean
	hasResult: boolean
	isError: boolean
	isCancelled: boolean
}

export class ToolLifecycle {
	private startedAt?: number
	private endedAt?: number
	private phase: ActivityPhase = 'queued'

	observe(progress: ToolProgress, now: number): void {
		if (
			progress.isStarted &&
			(!progress.hasResult || progress.isPartial) &&
			typeof this.endedAt !== 'number'
		)
			this.startedAt ??= now
		if (!progress.hasResult || progress.isPartial) {
			this.phase = progress.isStarted ? 'running' : 'queued'
			return
		}
		this.endedAt ??= now
		this.phase = progress.isError ? 'error' : 'success'
		if (progress.isCancelled) this.phase = 'cancelled'
	}

	view(now: number): { phase: ActivityPhase; elapsedMs: number | undefined } {
		return {
			phase: this.phase,
			elapsedMs:
				typeof this.startedAt === 'number'
					? Math.max(0, (this.endedAt ?? now) - this.startedAt)
					: undefined,
		}
	}
}
