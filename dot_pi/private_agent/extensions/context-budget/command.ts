/** `/context-budget`: choose and persist the automatic compaction ceiling. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { getAgentDir } from '@earendil-works/pi-coding-agent'

import { endSettleClaim } from '../settle-handshake/handshake.ts'

import {
	CEILING_CHOICES,
	MIN_CYCLE_GROWTH,
	parseCeiling,
	shortTokens,
} from './budget.ts'
import { writeCeiling } from './store.ts'

import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from '@earendil-works/pi-coding-agent'
import type { AutocompleteItem } from '@earendil-works/pi-tui'
import type { Ceiling } from './budget.ts'
import type { ContextGuard } from './guard.ts'

export const STATUS_KEY = 'context-budget'

const DEFAULT_KEPT_TAIL = 20_000

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
		// Pi's default is the safe fallback for a missing or unreadable setting.
	}
	return DEFAULT_KEPT_TAIL
}

function ceilingLabel(ceiling: Ceiling): string {
	return ceiling === 'off' ? 'off' : shortTokens(ceiling)
}

async function chooseCeiling(
	ctx: ExtensionCommandContext,
	args: string,
	current: Ceiling,
): Promise<Ceiling | undefined> {
	const parsed = parseCeiling(args)
	if (parsed) return validateCeiling(ctx, parsed)
	if (args.trim()) {
		ctx.ui.notify(
			`Unrecognised ceiling "${args.trim()}" - use 56k, 96k, 128k, 192k, 256k, 428k, or off`,
			'error',
		)
		return undefined
	}
	const picked = await ctx.ui.select(
		`Context compaction ceiling (now ${ceilingLabel(current)})`,
		[...CEILING_CHOICES.map(shortTokens), 'off'],
	)
	if (!picked) return undefined
	const selected = parseCeiling(picked)
	if (!selected) return undefined
	return validateCeiling(ctx, selected)
}

function validateCeiling(
	ctx: ExtensionCommandContext,
	ceiling: Ceiling,
): Ceiling | undefined {
	if (ceiling === 'off') return ceiling
	const tail = keptTailTokens()
	const floor = tail + MIN_CYCLE_GROWTH
	if (ceiling >= floor) return ceiling
	ctx.ui.notify(
		`A ${shortTokens(ceiling)} ceiling cannot leave ${shortTokens(MIN_CYCLE_GROWTH)} of measured growth above the ${shortTokens(tail)} retained tail. Use ${shortTokens(floor)} or higher, or lower compaction.keepRecentTokens.`,
		'error',
	)
	return undefined
}

function argumentCompletions(prefix: string): AutocompleteItem[] | null {
	const matches = [...CEILING_CHOICES.map(shortTokens), 'off'].filter(
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
		description: 'Choose the prompt ceiling for automatic compaction',
		getArgumentCompletions: argumentCompletions,
		handler: async (args, ctx) => {
			const next = await chooseCeiling(ctx, args, guard.currentCeiling())
			if (!next) return
			writeCeiling(getAgentDir(), next)
			guard.enable(next)
			endSettleClaim()
			ctx.ui.setStatus(STATUS_KEY, undefined)
			ctx.ui.notify(
				next === 'off'
					? 'Automatic context compaction disabled'
					: `Context compaction ceiling set to ${shortTokens(next)}`,
				'info',
			)
		},
	})
}
