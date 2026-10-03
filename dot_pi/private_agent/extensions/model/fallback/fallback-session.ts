/**
 * fallback - what one session remembers between provider outcomes.
 *
 * Own recovery decisions for the current session, without IO. Callers inject
 * timestamps and perform Pi calls. retry-budget.ts owns retry credits and
 * plans; chain.ts owns candidate ordering and cooldown calculations.
 */

import {
	activeExclusions,
	fallbackCandidates,
	recordExclusion,
} from './chain.ts'
import { TransientRetryBudget } from './retry-budget.ts'
import {
	classifyErrorText,
	classifyStatus,
	isDeterministicFailure,
} from './taxonomy.ts'

import type { AgentActivityOutcome } from '@earendil-works/pi-coding-agent'
import type { Exclusions } from './chain.ts'
import type { ModelFallbackConfig } from './config.ts'
import type { RetryPlan } from './retry-budget.ts'

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
	private isLastRunClean = false
	private selfSwitches: string[] = []
	private retryBudget = new TransientRetryBudget()

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
		this.isLastRunClean = false
		this.selfSwitches = []
		this.retryBudget.reset()
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

	/** Compaction responses never become model-failure evidence. */
	noteResponse(status: number, currentModel: string | undefined): void {
		if (this.isCompacting) return
		const failureClass = classifyStatus(status)
		if (failureClass === 'none') return
		this.failure = { model: currentModel, reason: `HTTP ${status}` }
	}

	/** Provider errors recover unless they overflow; clean runs clear recovery flags. */
	noteRunEnd(
		report: RunEndReport,
		currentModel: string | undefined,
		now: number,
	): void {
		this.isLastRunClean = false
		if (report.stopReason === 'aborted') {
			// A user abort wins over a sighting: recovery never acts on the
			// evidence from behind a human's choice to stop the run.
			this.failure = undefined
			return
		}
		if (report.stopReason !== 'error') {
			this.failure = undefined
			this.isLastRunClean = true
			this.retryBudget.reset()
			if (currentModel) this.exclusions.delete(currentModel)
			return
		}
		const reason = report.errorText?.trim() || 'provider error'
		if (classifyErrorText(reason) === 'overflow') {
			// pi compacts and retries; no other model can fit the input.
			this.failure = undefined
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

	/** Consume per-run recovery flags at Pi's final settle boundary. */
	settle(): SettleDecision {
		const decision: SettleDecision = {
			failure: this.config.autoFallback ? this.failure : undefined,
			shouldRestore:
				this.isLastRunClean &&
				this.isOnFallback &&
				this.config.restoreOnSuccess,
		}
		this.failure = undefined
		this.isLastRunClean = false
		return decision
	}

	/** Reserve a retry only for an eligible error boundary. */
	claimTransientRetry(outcome: AgentActivityOutcome): RetryPlan | undefined {
		if (outcome !== 'error' || !this.config.fastFailover) return undefined
		const { failure } = this
		if (this.isCompacting || !failure) return undefined
		// An account-state refusal (402 / insufficient balance) recurs
		// unchanged: keep the retry credit and cascade at the settle instead.
		if (isDeterministicFailure(failure.reason)) return undefined
		const plan = this.retryBudget.claim(failure, this.config)
		if (!plan) return undefined
		// A suppressed continuation must not cascade from the already handled failure.
		this.failure = undefined
		return plan
	}

	/** Recover the preferred model at a clean, eligible turn boundary. */
	shouldRecoverAtBoundary(
		outcome: AgentActivityOutcome,
		now: number,
	): boolean {
		const { restoreTarget } = this
		if (!restoreTarget || !this.isOnFallback || this.failure) return false
		if (this.isCompacting || !this.config.restoreOnSuccess) return false
		if (outcome !== 'completed') return false
		return !this.isCoolingDown(restoreTarget, now)
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
