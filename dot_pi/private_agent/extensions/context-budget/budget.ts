/** Pure context-budget thresholds and display policy. */

const TOKENS_PER_THOUSAND = 1000
const TOKENS_PER_MILLION = 1_000_000
const PERCENT = 100

const CEILING_48K = 48_000
const CEILING_56K = 56_000
const CEILING_64K = 64_000
const CEILING_80K = 80_000
const CEILING_96K = 96_000
const CEILING_112K = 112_000
const CEILING_128K = 128_000
const CEILING_144K = 144_000
const CEILING_160K = 160_000
const CEILING_192K = 192_000
const CEILING_224K = 224_000
const CEILING_256K = 256_000
const CEILING_320K = 320_000
const CEILING_384K = 384_000
const CEILING_428K = 428_000

export const CEILING_CHOICES = [
	CEILING_48K,
	CEILING_56K,
	CEILING_64K,
	CEILING_80K,
	CEILING_96K,
	CEILING_112K,
	CEILING_128K,
	CEILING_144K,
	CEILING_160K,
	CEILING_192K,
	CEILING_224K,
	CEILING_256K,
	CEILING_320K,
	CEILING_384K,
	CEILING_428K,
]

export const DEFAULT_CEILING_TOKENS = CEILING_128K
export const CEILING_WINDOW_RATIO = 0.55
export const MIN_CYCLE_GROWTH = 48_000
export const MIN_WORK_TURNS = 2

export const MIN_CEILING = 16_000
const WARN_RATIO = 0.7
const TRIGGER_RESERVE_RATIO = 0.15
const RECOVERY_RATIO = 0.5
const PROVIDER_RUNWAY = 16_000

export type Ceiling = number | 'off'
export type BudgetLevel = 'ok' | 'warn' | 'compact'

/** Trigger early enough that a long tool run cannot consume the whole ceiling. */
export function compactionTrigger(ceiling: number): number {
	const reserve = Math.max(
		PROVIDER_RUNWAY,
		Math.ceil(ceiling * TRIGGER_RESERVE_RATIO),
	)
	return ceiling - reserve
}

/** A compaction must land here before another automatic cycle can arm. */
export function recoveryTarget(ceiling: number): number {
	return Math.floor(ceiling * RECOVERY_RATIO)
}

export function budgetLevel(tokens: number, ceiling: number): BudgetLevel {
	if (tokens >= compactionTrigger(ceiling)) return 'compact'
	if (tokens >= ceiling * WARN_RATIO) return 'warn'
	return 'ok'
}

export function clampCeiling(ceiling: number, windowTokens?: number): number {
	if (typeof windowTokens !== 'number' || windowTokens <= 0) return ceiling
	const fitted = Math.floor(windowTokens * CEILING_WINDOW_RATIO)
	return Math.min(ceiling, Math.max(MIN_CEILING, fitted))
}

export function capForObservedLimit(
	ceiling: number,
	overflowAt: number | undefined,
): number {
	if (typeof overflowAt !== 'number' || overflowAt <= 0) return ceiling
	return Math.min(
		ceiling,
		Math.max(MIN_CEILING, overflowAt - PROVIDER_RUNWAY),
	)
}

export function shortTokens(count: number): string {
	if (count >= TOKENS_PER_MILLION) {
		const millions =
			Math.round(count / (TOKENS_PER_MILLION / PERCENT)) / PERCENT
		return `${millions}M`
	}
	return `${Math.round(count / TOKENS_PER_THOUSAND)}k`
}

export function statusText(tokens: number, ceiling: number): string {
	return `ctx ${shortTokens(tokens)}/${shortTokens(ceiling)} · auto-compacts`
}

export function parseCeiling(raw: string): Ceiling | undefined {
	const text = raw.trim().toLowerCase()
	if (!text) return undefined
	if (text === 'off' || text === 'none') return 'off'
	const match = /^(\d+(?:\.\d+)?)\s*k?$/.exec(text)
	if (!match) return undefined
	const written = Number(match[1])
	const inThousands = text.endsWith('k') || written < TOKENS_PER_THOUSAND
	const ceiling = Math.round(
		written * (inThousands ? TOKENS_PER_THOUSAND : 1),
	)
	if (!Number.isFinite(ceiling) || ceiling < MIN_CEILING) return undefined
	return ceiling
}
