/**
 * model-fallback - what one session remembers between provider outcomes.
 *
 * A failover decision only makes sense in the context of the session that
 * produced the failure: which model already failed here, where the session
 * started, which model switch this extension issued itself, and whether the
 * last run ended cleanly. Those facts live together in one state machine with
 * no IO - the caller injects the clock and performs every pi call - so each
 * transition is unit-tested in `../tests/model-fallback.test.ts` without a
 * session: a doomed first response, an overflow, a user abort, our own switch.
 */

import {
	activeExclusions,
	fallbackCandidates,
	recordExclusion,
} from './chain.ts'
import { classifyErrorText, classifyStatus } from './taxonomy.ts'

import type { Exclusions } from './chain.ts'
import type { ModelFallbackConfig } from './config.ts'

/** A failed attempt the settled run has to act on. */
export interface FailureSighting {
	model: string | undefined
	reason: string
}

/**
 * The fields of pi's assistant message that describe how a run ended. pi's
 * vocabulary is `stop | length | error | aborted`; only `aborted` and `error`
 * need a decision here, every other value is a completed run.
 */
export interface RunEndReport {
	stopReason: string
	errorText: string | undefined
}

/** What a settled agent must do next: at most one of the two. */
export interface SettleDecision {
	/** Set when a run failed, auto-fallback is on, and a model must move. */
	failure: FailureSighting | undefined
	/** Set when a clean run may return the session to its original model. */
	shouldRestore: boolean
}

export class FallbackSession {
	private config: ModelFallbackConfig
	private exclusions: Exclusions = new Map()
	private restoreTarget: string | undefined
	private isOnFallback = false
	private failure: FailureSighting | undefined
	private isCompacting = false
	private callCount = 0
	private didIssueAutoAbort = false
	private isLastRunClean = false
	private selfSwitches: string[] = []

	constructor(config: ModelFallbackConfig) {
		this.config = config
	}

	/** A new session (or a reload) keeps its config and forgets the rest. */
	startSession(config: ModelFallbackConfig): void {
		this.config = config
		this.exclusions = new Map()
		this.restoreTarget = undefined
		this.isOnFallback = false
		this.failure = undefined
		this.isCompacting = false
		this.callCount = 0
		this.didIssueAutoAbort = false
		this.isLastRunClean = false
		this.selfSwitches = []
	}

	/** The config in force, for the status line and the menu. */
	currentConfig(): ModelFallbackConfig {
		return this.config
	}

	/** Every cooldown recorded so far, expired ones included. */
	currentCooldowns(): ReadonlyMap<string, number> {
		return this.exclusions
	}

	/** The config the user just changed; the caller persists it. */
	setConfig(config: ModelFallbackConfig): void {
		this.config = config
	}

	/** A low-level run begins: the provider calls of this run count from zero. */
	startRun(): void {
		this.callCount = 0
	}

	/** One provider call of the current run has started. */
	beginCall(): void {
		this.callCount += 1
	}

	/**
	 * Records what one provider response said, and reports whether the caller
	 * must abort the attempt: a 5xx on the first call of a run is doomed, and
	 * pi's own retries would only burn the same failure again.
	 */
	noteResponse(
		status: number,
		currentModel: string | undefined,
		isIdle: boolean,
	): boolean {
		if (this.isCompacting) return false
		const failureClass = classifyStatus(status)
		if (failureClass === 'none') return false
		this.failure = { model: currentModel, reason: `HTTP ${status}` }
		if (failureClass !== 'failover-fast' || !this.config.fastFailover) {
			return false
		}
		if (this.callCount > 1 || isIdle) return false
		this.didIssueAutoAbort = true
		return true
	}

	/**
	 * How the run ended, as far as failover is concerned: a retryable provider
	 * error is the sighting the settled agent acts on, an overflow belongs to
	 * pi's compaction, and a completed run clears the sighting and may restore.
	 */
	noteRunEnd(
		report: RunEndReport,
		currentModel: string | undefined,
		now: number,
	): void {
		if (report.stopReason === 'aborted') {
			// A user abort wins over a sighting; our own abort keeps it.
			if (!this.didIssueAutoAbort) this.failure = undefined
			this.didIssueAutoAbort = false
			return
		}
		if (report.stopReason !== 'error') {
			this.failure = undefined
			this.didIssueAutoAbort = false
			this.isLastRunClean = true
			if (currentModel) this.exclusions.delete(currentModel)
			return
		}
		const reason = report.errorText?.trim() || 'provider error'
		const failureClass = classifyErrorText(reason)
		if (failureClass === 'overflow') {
			// pi compacts and retries; no other model can fit the input.
			this.failure = undefined
			this.didIssueAutoAbort = false
			return
		}
		if (failureClass !== 'retryable') {
			this.didIssueAutoAbort = false
			return
		}
		this.failure = { model: currentModel, reason }
		recordExclusion(
			this.exclusions,
			currentModel,
			now,
			this.config.exclusionTtlMs,
		)
	}

	/**
	 * A settled agent is the first moment pi will not continue on its own, so
	 * this consumes the per-run flags: a failure to fail over from, or a clean
	 * run that may return the session to where it started. Neither when the
	 * matching toggle is off.
	 */
	settle(): SettleDecision {
		const decision: SettleDecision = {
			failure: this.config.autoFallback ? this.failure : undefined,
			shouldRestore:
				this.isLastRunClean &&
				this.isOnFallback &&
				this.config.restoreOnSuccess,
		}
		this.failure = undefined
		this.didIssueAutoAbort = false
		this.isLastRunClean = false
		return decision
	}

	/** The chain after `failedModel`, ordered and without cooling models. */
	candidatesAfter(failedModel: string | undefined, now: number): string[] {
		return fallbackCandidates(
			failedModel,
			this.config.chain,
			activeExclusions(this.exclusions, now),
		)
	}

	/** A model that just failed stays out of the chain for the cooldown TTL. */
	coolDown(model: string | undefined, now: number): void {
		recordExclusion(this.exclusions, model, now, this.config.exclusionTtlMs)
	}

	/** A cooling model must not be restored to: that is the flapping loop. */
	isCoolingDown(model: string, now: number): boolean {
		return activeExclusions(this.exclusions, now).has(model)
	}

	/**
	 * Records a failover: the streak remembers the model the session started
	 * from, so a clean run can return there.
	 */
	markFallbackActive(failedModel: string | undefined): void {
		this.restoreTarget ??= failedModel
		this.isOnFallback = true
	}

	/** The model a clean run returns to, if any. */
	restoreModel(): string | undefined {
		return this.restoreTarget
	}

	/** Nothing is on a fallback anymore: the user took over, or we restored. */
	clearFallback(): void {
		this.restoreTarget = undefined
		this.isOnFallback = false
	}

	/** A model switch this extension is about to issue. */
	trackSwitch(model: string): void {
		this.selfSwitches.push(model)
	}

	/** Forgets a tracked switch pi refused - the session never moved. */
	forgetSwitch(model: string): void {
		const last = this.selfSwitches.lastIndexOf(model)
		if (last !== -1) this.selfSwitches.splice(last, 1)
	}

	/**
	 * Whether `model_select` reports a switch of our own: ours is consumed
	 * silently, while someone else's means a human took over the session.
	 */
	consumeSwitch(model: string): boolean {
		const index = this.selfSwitches.indexOf(model)
		if (index === -1) return false
		this.selfSwitches.splice(index, 1)
		return true
	}

	/**
	 * pi is compacting: the responses it reads on the way belong to that
	 * compaction, never to a failover decision.
	 */
	enterCompaction(): void {
		this.isCompacting = true
	}

	leaveCompaction(): void {
		this.isCompacting = false
	}
}
