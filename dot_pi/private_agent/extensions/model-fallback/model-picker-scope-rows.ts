/**
 * model-fallback - the scope tab's rows: each saved `enabledModels` entry once,
 * in file order, followed by the resolved models no saved entry names.
 *
 * An exact entry carries what it resolved to as metadata, so a scoped model is
 * neither listed twice nor mislabelled; a wildcard stays one row.
 */

import { entryNamesReference, isScopePattern } from './model-catalog.ts'

import type { PickerView, ScopeEntry } from './model-picker-view.ts'

export type ScopeRow =
	| {
			kind: 'entry'
			index: number
			entry: string
			isPattern: boolean
			resolved: ScopeEntry | undefined
	  }
	| { kind: 'session'; entry: ScopeEntry }

/**
 * The scope tab's rows: each saved entry once, in file order, followed by the
 * resolved models no saved entry names. An exact entry carries what it resolved
 * to as metadata, so a scoped model is never listed twice.
 */
export function scopeRows(view: PickerView): ScopeRow[] {
	const references = view.scope.map(entry => entry.reference)
	const named = new Set<string>()
	const entries = view.patterns.map((entry, index): ScopeRow => {
		const names = entryNamesReference(entry, references)
		const resolved = names
			? view.scope.find(scopeEntry => scopeEntry.reference === names)
			: undefined
		if (resolved) named.add(resolved.reference)
		return {
			kind: 'entry',
			index,
			entry,
			isPattern: isScopePattern(entry),
			resolved,
		}
	})
	const session = view.scope
		.filter(entry => !named.has(entry.reference))
		.map((entry): ScopeRow => ({ kind: 'session', entry }))
	return [...entries, ...session]
}
