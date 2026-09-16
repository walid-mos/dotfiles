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

/** Overshoot that allows one repeated nudge when the first was ignored. */
const REPEAT_RATIO = 1.25

/** Nudges per session, so an ignored ceiling cannot spam the transcript. */
export const MAX_NUDGES = 2

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
	if (tokens >= ceiling) return 'handoff'
	if (tokens >= ceiling * WARN_RATIO) return 'warn'
	return 'ok'
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

/** Footer status for a known prompt size, e.g. `ctx 112k/128k`. */
export function statusText(tokens: number, ceiling: number): string {
	return `ctx ${shortTokens(tokens)}/${shortTokens(ceiling)}`
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
 * Whether the guard should nudge again: always at the ceiling, then once more
 * only if the prompt kept growing past it (models sometimes ignore a steer).
 * `sent` is how many nudges this session already delivered.
 */
export function shouldNudge(
	tokens: number,
	ceiling: number,
	sent: number,
): boolean {
	if (sent >= MAX_NUDGES || tokens < ceiling) return false
	if (sent === 0) return true
	return tokens >= ceiling * REPEAT_RATIO
}

/** A `SKILL.md` body with its YAML frontmatter removed. */
export function skillBody(markdown: string): string {
	const frontmatter = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(markdown)
	const body = frontmatter ? markdown.slice(frontmatter[0].length) : markdown
	return body.trim()
}

/**
 * Degraded handoff spec, used only when the `handoff` skill cannot be
 * resolved. Deliberately one sentence: the skill owns the full rules, and a
 * second checklist here would drift from it.
 */
const FALLBACK_SPEC =
	'Cover the current goal, the state reached, decisions already made and the next step; reference existing artifacts (plans, diffs, commits) by path instead of copying them.'

/**
 * The message steered into the running turn when the ceiling is reached. The
 * agent writes the handoff to `path`; `body` is the registered `handoff` skill
 * verbatim, copied in because that skill is hidden from the model
 * (`disable-model-invocation`), so the agent cannot load it on its own.
 */
export function handoffDirective(input: {
	ceiling: number
	path: string
	body: string | undefined
	/** Settle retry number: the previous run ended without writing the file. */
	retry?: number
}): string {
	const { ceiling, path, body } = input
	const retry = input.retry ?? 0
	return [
		retry > 0
			? `The handoff file still does not exist: the last run ended without writing it (retry ${retry}).`
			: `Context budget reached: this prompt is at the ${shortTokens(ceiling)} ceiling set for this session, and cost is linear in prompt size.`,
		'Stop expanding the context now, write the resumption handoff, then end your turn.',
		'',
		`Write it to: ${path}`,
		'',
		body ?? FALLBACK_SPEC,
		'',
		'Do not start new edits, investigations or tool loops. Once the file is written, reply with three lines only: goal, current state, next step.',
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
