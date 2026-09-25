/** Pure state machine for measured context compaction cycles. */

import {
	MIN_CYCLE_GROWTH,
	MIN_WORK_TURNS,
	budgetLevel,
	capForObservedLimit,
	clampCeiling,
	compactionTrigger,
	recoveryTarget,
	statusText,
} from './budget.ts'

import type { Ceiling } from './budget.ts'
import type {
	CyclePhase,
	GuardAction,
	GuardSnapshot,
	SettleAction,
} from './guard-state.ts'

export class ContextGuard {
	private ceiling: Ceiling = 'off'
	private phase: CyclePhase = 'armed'
	private hasWarned = false
	private effectiveCeiling: number | undefined
	private baselineTokens: number | undefined
	private baselineAt: number | undefined
	private workTurns = 0
	private lastTokens = 0
	private recoveryUsed = false
	private isStrictCompaction = false
	private hasBlockedNotice = false
	private activeModel = 'unknown/unknown'
	private readonly overflowByModel = new Map<string, number>()

	enable(ceiling: Ceiling): void {
		this.ceiling = ceiling
		this.resetCycle('armed')
	}

	cancelCycle(): void {
		this.resetCycle('armed')
	}

	selectModel(key: string): void {
		if (key === this.activeModel) return
		this.activeModel = key
		this.resetCycle('armed')
	}

	noteOverflow(tokensBefore: number, key: string): void {
		if (!Number.isFinite(tokensBefore) || tokensBefore <= 0) return
		const previous = this.overflowByModel.get(key)
		this.overflowByModel.set(
			key,
			previous ? Math.min(previous, tokensBefore) : tokensBefore,
		)
	}

	compactionIsStrict(): boolean {
		return this.isStrictCompaction
	}

	noteCompacted(): void {
		this.phase = 'awaiting-baseline'
		this.isStrictCompaction = false
		this.hasWarned = false
		this.baselineTokens = undefined
		this.baselineAt = undefined
		this.workTurns = 0
	}

	noteCompactionFailed(): void {
		this.phase = 'blocked'
		this.isStrictCompaction = false
		this.hasBlockedNotice = true
	}

	currentCeiling(): Ceiling {
		return this.ceiling
	}

	snapshot(): GuardSnapshot | undefined {
		if (this.ceiling === 'off' || !this.effectiveCeiling) return undefined
		return {
			phase: this.phase,
			ceiling: this.effectiveCeiling,
			trigger: compactionTrigger(this.effectiveCeiling),
			target: recoveryTarget(this.effectiveCeiling),
			baselineTokens: this.baselineTokens,
			growthTokens:
				typeof this.baselineTokens === 'number'
					? this.lastTokens - this.baselineTokens
					: undefined,
			workTurns: this.workTurns,
			elapsedMs:
				typeof this.baselineAt === 'number'
					? Date.now() - this.baselineAt
					: undefined,
		}
	}

	next(tokens: number, key: string, windowTokens?: number): GuardAction {
		this.selectModel(key)
		this.lastTokens = tokens
		if (this.ceiling === 'off') return { type: 'clear' }
		const observed = this.overflowByModel.get(key)
		const capped = capForObservedLimit(this.ceiling, observed)
		const effective = clampCeiling(capped, windowTokens)
		this.effectiveCeiling = effective
		if (this.phase === 'awaiting-baseline') {
			return this.acceptBaseline(tokens, effective)
		}
		if (this.phase === 'blocked') {
			return this.blockedAction(tokens, effective)
		}
		if (this.phase === 'pending' || this.phase === 'pending-recovery') {
			return {
				type: 'status',
				status: statusText(tokens, effective),
				shouldClaim: true,
			}
		}
		if (this.phase === 'compacting') {
			return {
				type: 'status',
				status: 'context compaction in progress',
				shouldClaim: true,
			}
		}
		if (this.phase === 'cooldown') {
			return this.afterBaseline(tokens, effective)
		}
		return this.whenArmed(tokens, effective)
	}

	settled(): SettleAction {
		if (this.phase !== 'pending' && this.phase !== 'pending-recovery') {
			return { type: 'idle' }
		}
		const isStrict = this.phase === 'pending-recovery'
		const ceiling = this.effectiveCeiling
		if (!ceiling) return { type: 'idle' }
		this.phase = 'compacting'
		this.isStrictCompaction = isStrict
		return {
			type: 'compact',
			isStrict,
			tokensBefore: this.lastTokens,
			ceiling,
			target: recoveryTarget(ceiling),
		}
	}

	private acceptBaseline(tokens: number, ceiling: number): GuardAction {
		const target = recoveryTarget(ceiling)
		this.baselineTokens = tokens
		this.baselineAt = Date.now()
		this.workTurns = 0
		if (tokens <= target) {
			const outcome = this.recoveryUsed ? 'recovery' : 'accepted'
			this.phase = 'cooldown'
			this.recoveryUsed = false
			return { type: 'baseline', tokens, ceiling, target, outcome }
		}
		if (!this.recoveryUsed) {
			this.recoveryUsed = true
			this.phase = 'pending-recovery'
			return {
				type: 'recover',
				status: statusText(tokens, ceiling),
				tokens,
				ceiling,
				target,
			}
		}
		this.phase = 'blocked'
		return this.blockedAction(tokens, ceiling)
	}

	private afterBaseline(tokens: number, ceiling: number): GuardAction {
		this.workTurns += 1
		const growth = tokens - (this.baselineTokens ?? tokens)
		const canRearm =
			growth >= MIN_CYCLE_GROWTH && this.workTurns >= MIN_WORK_TURNS
		if (
			tokens >= ceiling ||
			(canRearm && tokens >= compactionTrigger(ceiling))
		) {
			this.phase = 'pending'
			return {
				type: 'pending',
				status: statusText(tokens, ceiling),
				tokens,
				ceiling,
			}
		}
		return this.nonTriggerAction(tokens, ceiling)
	}

	private whenArmed(tokens: number, ceiling: number): GuardAction {
		const level = budgetLevel(tokens, ceiling)
		if (level === 'compact') {
			this.phase = 'pending'
			return {
				type: 'pending',
				status: statusText(tokens, ceiling),
				tokens,
				ceiling,
			}
		}
		return this.nonTriggerAction(tokens, ceiling)
	}

	private nonTriggerAction(tokens: number, ceiling: number): GuardAction {
		if (budgetLevel(tokens, ceiling) !== 'warn') return { type: 'clear' }
		const status = statusText(tokens, ceiling)
		if (this.hasWarned) return { type: 'status', status }
		this.hasWarned = true
		return { type: 'warn', status, tokens, ceiling }
	}

	private blockedAction(tokens: number, ceiling: number): GuardAction {
		const status = 'context auto-compaction paused'
		if (this.hasBlockedNotice) return { type: 'status', status }
		this.hasBlockedNotice = true
		return {
			type: 'blocked',
			status,
			tokens,
			ceiling,
			target: recoveryTarget(ceiling),
		}
	}

	private resetCycle(phase: CyclePhase): void {
		this.phase = phase
		this.hasWarned = false
		this.effectiveCeiling = undefined
		this.baselineTokens = undefined
		this.baselineAt = undefined
		this.workTurns = 0
		this.lastTokens = 0
		this.recoveryUsed = false
		this.isStrictCompaction = false
		this.hasBlockedNotice = false
	}
}
