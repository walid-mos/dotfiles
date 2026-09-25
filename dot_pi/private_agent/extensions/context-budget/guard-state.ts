/** Public actions and snapshots produced by the context guard. */

export type GuardAction =
	| { type: 'clear' }
	| { type: 'status'; status: string; shouldClaim?: boolean }
	| {
			type: 'baseline'
			tokens: number
			ceiling: number
			target: number
			outcome: 'accepted' | 'recovery'
	  }
	| { type: 'warn'; status: string; tokens: number; ceiling: number }
	| { type: 'pending'; status: string; tokens: number; ceiling: number }
	| {
			type: 'recover'
			status: string
			tokens: number
			ceiling: number
			target: number
	  }
	| {
			type: 'blocked'
			status: string
			tokens: number
			ceiling: number
			target: number
	  }

export type SettleAction =
	| { type: 'idle' }
	| {
			type: 'compact'
			isStrict: boolean
			tokensBefore: number
			ceiling: number
			target: number
	  }

export type CyclePhase =
	| 'armed'
	| 'pending'
	| 'compacting'
	| 'awaiting-baseline'
	| 'cooldown'
	| 'pending-recovery'
	| 'blocked'

export type GuardSnapshot = {
	phase: CyclePhase
	ceiling: number
	trigger: number
	target: number
	baselineTokens: number | undefined
	growthTokens: number | undefined
	workTurns: number
	elapsedMs: number | undefined
}

export function modelKey(
	model: { provider: string; id: string } | undefined,
): string {
	return model ? `${model.provider}/${model.id}` : 'unknown/unknown'
}
