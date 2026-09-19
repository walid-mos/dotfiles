/**
 * context-budget - the `/context-budget` command: argument parsing with a
 * picker fallback, completions, and persisting the choice.
 *
 * Split from `index.ts` to keep the wiring thin. The ceiling semantics live
 * in `budget.ts`, the persistence in `store.ts`; the watchers that share the
 * status line import `STATUS_KEY` from here.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { getAgentDir } from '@earendil-works/pi-coding-agent'

import { HANDOFF_CHOICES, parseCeiling, shortTokens } from './budget.ts'
import { writeCeiling } from './store.ts'

import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from '@earendil-works/pi-coding-agent'
import type { AutocompleteItem } from '@earendil-works/pi-tui'
import type { Ceiling } from './budget.ts'
import type { ContextGuard } from './guard.ts'

/** Footer status line key, shared with the watchers in `index.ts`. */
export const STATUS_KEY = 'context-budget'

/** pi's default when `compaction.keepRecentTokens` is not set. */
const DEFAULT_KEPT_TAIL = 20_000

/**
 * Growth a cycle must leave room for, on top of the kept tail: below this
 * the post-continuation prompt (tail + summary + harness floor) is already
 * at the ceiling, and every cycle re-fires after a turn or two.
 */
const MIN_CYCLE_GROWTH = 64_000

/**
 * The kept tail pi carries verbatim across every compaction - the floor the
 * ceiling has to clear for a cycle to compress anything at all. Read from
 * settings.json rather than assumed, because that is exactly the value the
 * user can change under us.
 */
function keptTailTokens(): number {
	try {
		const parsed: unknown = JSON.parse(
			readFileSync(join(getAgentDir(), 'settings.json'), 'utf8'),
		)
		if (typeof parsed !== 'object' || parsed === null) {
			return DEFAULT_KEPT_TAIL
		}
		const compaction = Reflect.get(parsed, 'compaction')
		if (typeof compaction !== 'object' || compaction === null) {
			return DEFAULT_KEPT_TAIL
		}
		const kept = Reflect.get(compaction, 'keepRecentTokens')
		if (typeof kept === 'number' && Number.isFinite(kept) && kept > 0) {
			return kept
		}
	} catch {
		// Absent or unreadable: fall through to the default.
	}
	return DEFAULT_KEPT_TAIL
}

function ceilingLabel(ceiling: Ceiling): string {
	return ceiling === 'off' ? 'off' : shortTokens(ceiling)
}

/** The ceiling requested by an argument or the picker; undefined is cancelled. */
async function chooseCeiling(
	ctx: ExtensionCommandContext,
	args: string,
	current: Ceiling,
): Promise<Ceiling | undefined> {
	const parsed = parseCeiling(args)
	if (parsed) {
		if (parsed === 'off') return parsed
		const tail = keptTailTokens()
		const floor = tail + MIN_CYCLE_GROWTH
		if (parsed < floor) {
			ctx.ui.notify(
				`A ${shortTokens(parsed)} ceiling is below the ${shortTokens(tail)} compaction kept tail: every cycle would re-fire almost immediately. Use ${shortTokens(floor)} or higher, or lower compaction.keepRecentTokens.`,
				'error',
			)
			return undefined
		}
		return parsed
	}
	if (args.trim()) {
		ctx.ui.notify(
			`Unrecognised ceiling "${args.trim()}" - use 56k, 96k, 128k, 192k, 256k, 428k, or off`,
			'error',
		)
		return undefined
	}
	const picked = await ctx.ui.select(
		`Context handoff ceiling (now ${ceilingLabel(current)})`,
		[...HANDOFF_CHOICES.map(shortTokens), 'off'],
	)
	if (!picked) return undefined
	return parseCeiling(picked)
}

function argumentCompletions(prefix: string): AutocompleteItem[] | null {
	const matches = [...HANDOFF_CHOICES.map(shortTokens), 'off'].filter(
		option => option.startsWith(prefix),
	)
	if (!matches.length) return null
	return matches.map(option => ({ value: option, label: option }))
}

export function registerCeilingCommand(
	pi: ExtensionAPI,
	guard: ContextGuard,
): void {
	pi.registerCommand('context-budget', {
		description:
			'Choose the prompt ceiling that triggers a resumption handoff',
		getArgumentCompletions: argumentCompletions,
		handler: async (args, ctx) => {
			const next = await chooseCeiling(ctx, args, guard.currentCeiling())
			if (!next) return
			const unchanged = next === guard.currentCeiling()
			writeCeiling(getAgentDir(), next)
			if (unchanged && guard.handoffFile) {
				// Re-selecting the same ceiling mid-cycle must not orphan a
				// handoff already in flight: enable() would drop its path and
				// retry ladder.
				ctx.ui.notify(
					`Ceiling unchanged (${ceilingLabel(next)}) - handoff already in flight at ${guard.handoffFile}.`,
					'warning',
				)
				return
			}
			guard.enable(next)
			ctx.ui.setStatus(STATUS_KEY, undefined)
			ctx.ui.notify(
				next === 'off'
					? 'Context handoff ceiling disabled'
					: `Context handoff ceiling set to ${shortTokens(next)}`,
				'info',
			)
		},
	})
}
