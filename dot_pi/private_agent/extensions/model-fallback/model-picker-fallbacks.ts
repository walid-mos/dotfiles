/**
 * model-fallback - the fallbacks tab's rows: the ordered chain, the models a
 * user can append to it, and the toggles that decide what happens on a failure.
 *
 * The chain's order *is* the failover order, so its rows carry the stored order
 * and nothing here sorts them. The toggles come last, behind a rule, because
 * they are a different kind of row: options, not models.
 */

import type { PickerView, RowGroup } from './model-picker-view.ts'

export const TOGGLE_FIELDS = [
	'autoFallback',
	'restoreOnSuccess',
	'fastFailover',
] as const

export type ToggleField = (typeof TOGGLE_FIELDS)[number]

export type FallbackRow =
	| {
			kind: 'toggle'
			field: ToggleField
			label: string
			isOn: boolean
	  }
	| {
			kind: 'chain'
			index: number
			reference: string
			isCoolingDown: boolean
	  }
	| { kind: 'candidate'; reference: string }

const TOGGLE_LABELS: Record<ToggleField, string> = {
	autoFallback: 'auto-fallback on provider failure',
	restoreOnSuccess: 'restore the original model after a clean turn',
	fastFailover: 'abort the first attempt on a 5xx',
}

function isCoolingDown(view: PickerView, reference: string): boolean {
	return (view.cooldowns.get(reference) ?? 0) > view.now
}

/**
 * Toggles last, behind a rule: a mixed fallbacks list is its model rows first
 * (the chain in failover order, then the in-scope models a user can append)
 * and its options after. The chain keeps its stored order - that order *is* the
 * failover order - and a model never appears twice.
 */
export function fallbackRows(view: PickerView): FallbackRow[] {
	const chain = view.config.chain.map((reference, index): FallbackRow => ({
		kind: 'chain',
		index,
		reference,
		isCoolingDown: isCoolingDown(view, reference),
	}))
	const candidates = view.rows
		.filter(
			row =>
				row.isInScope &&
				row.reference !== view.currentReference &&
				!view.config.chain.includes(row.reference),
		)
		.map((row): FallbackRow => ({
			kind: 'candidate',
			reference: row.reference,
		}))
	const toggles = TOGGLE_FIELDS.map((field): FallbackRow => ({
		kind: 'toggle',
		field,
		label: TOGGLE_LABELS[field],
		isOn: view.config[field],
	}))
	return [...chain, ...candidates, ...toggles]
}

/** The fallbacks split: one rule above the options group, when both exist. */
export function fallbackGroups(rows: readonly FallbackRow[]): RowGroup[] {
	const firstOption = rows.findIndex(row => row.kind === 'toggle')
	if (firstOption <= 0) return []
	return [{ firstRow: firstOption, label: 'options' }]
}
