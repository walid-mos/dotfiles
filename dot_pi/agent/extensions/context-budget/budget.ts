/**
 * context-budget - pure budget policy: the ceiling choices, the level a known
 * prompt size falls into, and the texts the guard injects.
 *
 * Nothing here touches IO, pi or the TUI; `index.ts` wires these values to pi,
 * `store.ts` persists the choice, `handoff.ts` resolves paths. Keeping the
 * policy pure is what makes the thresholds testable in
 * `../tests/context-budget.test.ts`.
 */

const TOKENS_PER_THOUSAND = 1000
const TOKENS_PER_MILLION = 1_000_000

/** Percent scale used to keep the million display to two decimals. */
const PERCENT = 100

// Ladder offered by `/context-budget`. The steps are tight below 128k, where
// one step is a large share of the ceiling and of the bill, and widen above
// 192k, where the prompt is already expensive enough to be an obvious choice.
// Any value can still be typed (`/context-budget 137k`); this list is the
// picker's shortcut.
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

/** Ceilings offered by `/context-budget`, in tokens, ascending. */
export const HANDOFF_CHOICES = [
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

/** Ceiling in force until the user picks another one. */
export const DEFAULT_HANDOFF_TOKENS = CEILING_128K

/** Below this a session cannot do useful work, so smaller input is rejected. */
const MIN_HANDOFF_TOKENS = 16_000

/** Fraction of the ceiling where the burn rate stops being silent. */
const WARN_RATIO = 0.75

/**
 * Runway the handoff-writing turn needs: the settle trigger fires this many
 * tokens before the ceiling, so the write-and-end-turn always fits above it.
 * Firing at the ceiling itself leaves none - and a session that watches the
 * footer climb into the last few percent starts improvising its own exit
 * (observed 2026-09-18: a session self-declared blocked at 152k/160k and asked
 * the user to spawn a fresh one) instead of waiting for the machinery.
 */
const HANDOFF_RUNWAY = 16_000

/**
 * Share of the model's window a configured ceiling may not exceed. A ceiling
 * above it leaves no room to finish the turn, and pi compacts on its own near
 * the window - a lossy summary, the exact outcome this extension exists to
 * avoid.
 */
export const CEILING_WINDOW_RATIO = 0.55

/**
 * Re-asks allowed once a run has settled without writing the handoff. Bounded
 * on purpose: a model that refuses to write the file must not turn the ceiling
 * into an endless loop of expensive turns.
 */
export const MAX_SETTLE_RETRIES = 3

export type BudgetLevel = 'ok' | 'warn' | 'handoff'

/** A disabled ceiling: no guard, no nudges. */
export type Ceiling = number | 'off'

export function budgetLevel(tokens: number, ceiling: number): BudgetLevel {
	// The handoff trigger never sits below the warn line: on small ceilings
	// `ceiling - runway` would fire before the burn rate was ever flagged.
	const trigger = Math.max(ceiling - HANDOFF_RUNWAY, ceiling * WARN_RATIO)
	if (tokens >= trigger) return 'handoff'
	if (tokens >= ceiling * WARN_RATIO) return 'warn'
	return 'ok'
}

/**
 * The configured ceiling clamped into the model's window. Unchanged when the
 * window is unknown (pi omits it in some modes, and the tests' doubles omit
 * it), or when clamping would floor the ceiling below the usable minimum.
 */
export function clampCeiling(ceiling: number, windowTokens?: number): number {
	if (typeof windowTokens !== 'number' || windowTokens <= 0) return ceiling
	const fitted = Math.floor(windowTokens * CEILING_WINDOW_RATIO)
	return Math.min(ceiling, Math.max(MIN_HANDOFF_TOKENS, fitted))
}

/**
 * The configured ceiling capped by a limit witnessed the hard way: a provider
 * that refused a request at `overflowAt` tokens.
 *
 * The declared window can lie. `deepseek-v4-flash` is configured at 1,000,000
 * tokens in `models.json`, and its API refused a 180,824-token request
 * (observed 2026-09-19, session 01a0b968): pi aborted the turn rather than run
 * it, and the handoff ask that had just gone out died with it. An observed
 * refusal therefore outranks the declared window - it is the only measurement
 * of the real limit this extension ever gets.
 */
export function capForObservedLimit(
	ceiling: number,
	overflowAt: number | undefined,
): number {
	if (typeof overflowAt !== 'number' || overflowAt <= 0) return ceiling
	return Math.min(
		ceiling,
		Math.max(MIN_HANDOFF_TOKENS, overflowAt - HANDOFF_RUNWAY),
	)
}

/** `56k`, `128k`, `1.05M` - short enough to share the footer status line. */
export function shortTokens(count: number): string {
	if (count >= TOKENS_PER_MILLION) {
		const millions =
			Math.round(count / (TOKENS_PER_MILLION / PERCENT)) / PERCENT
		return `${millions}M`
	}
	return `${Math.round(count / TOKENS_PER_THOUSAND)}k`
}

/**
 * Footer status for a known prompt size, e.g. `ctx 112k/128k`. The suffix is
 * contract, not decoration: a model watching the counter climb must know the
 * ceiling is handled - the session compacts from a handoff and continues on
 * its own - or it starts managing the budget itself.
 */
export function statusText(tokens: number, ceiling: number): string {
	return `ctx ${shortTokens(tokens)}/${shortTokens(ceiling)} · auto-continues`
}

/**
 * Parse a `/context-budget` argument. Accepts `96k`, `96000` and a bare `96`
 * (read as 96k, since no one means a 96-token ceiling), plus `off`.
 * Returns undefined for anything unrecognised so the caller can report it.
 */
export function parseCeiling(raw: string): number | 'off' | undefined {
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
	if (!Number.isFinite(ceiling) || ceiling < MIN_HANDOFF_TOKENS)
		return undefined
	return ceiling
}

/**
 * Instructions for the compaction pi runs when the handoff never appeared:
 * the fail-open tail. Directed at what a resumption needs, so pi's summary is
 * a poorer handoff rather than a generic one.
 */
export function fallbackCompactionText(): string {
	return [
		'Compact this session into a summary that stands alone for a fresh continuation. Preserve, in this order:',
		'- the current goal and the exact checklist item or plan step in flight;',
		'- what is done, and how each piece was verified;',
		'- decisions made, and why;',
		'- files read or modified;',
		'- the exact next step.',
		'Mark anything not verified this session as an assumption to re-check, and never carry secrets or personal data forward.',
	].join('\n')
}

/**
 * The message that asks for the handoff: steered mid-turn when the run is
 * near the model window, delivered at the settle boundary otherwise.
 *
 * Four lines, and no more: this lands in a prompt that is already at the
 * ceiling, so every word is paid at the worst possible moment. The content
 * rules ride in the directive itself rather than being copied from the
 * `handoff` skill, whose body used to be injected verbatim here.
 */
export function handoffDirective(input: {
	ceiling: number
	path: string
	/** Settle retry number: the previous run ended without a usable file. */
	retry?: number
}): string {
	const retry = input.retry ?? 0
	return [
		retry > 0
			? `Handoff file missing or unusable (retry ${retry}): write it now, then end your turn.`
			: `Context budget reached (${shortTokens(input.ceiling)} ceiling): write the resumption handoff now, then end your turn - the session compacts from that file and continues on its own.`,
		'No new scope, no new edits: read-only checks (git status, git diff, plan or checklist) only.',
		`Write it to: ${input.path}`,
		'Cover: goal and step in flight; what is done and how it was verified; decisions and why; files in play; the exact next step; anything not verified this session. It must stand alone - reference artifacts by path instead of copying them, and redact secrets.',
		'Reply with three lines only: goal, current state, next step.',
	].join('\n')
}

/**
 * The message that restarts the work once the compaction has replaced the
 * conversation with the handoff. It does not send the agent back to the file:
 * the handoff *is* the context now, and reading it again would pay for the same
 * tokens twice.
 */
export function continuationText(): string {
	return [
		'Continue the task from the handoff you just wrote - it replaced the summarized conversation in your context.',
		'Pick up at its next step; do not repeat work it records as done.',
	].join('\n')
}
