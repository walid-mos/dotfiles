/**
 * model-fallback - the models the picker lists, and which ones this session may
 * use right now.
 *
 * Rows come from the catalogue pi reports as available; the session scope is a
 * marking on those rows, not a filter, so a model outside the scope is still
 * reachable for this session while the picker shows that it is out of scope.
 * Supported reasoning levels come from pi's own model metadata - never a
 * hand-written list.
 */

import { getSupportedThinkingLevels } from '@earendil-works/pi-ai'

import { modelReference } from './chain.ts'

import type { Api, Model, ModelThinkingLevel } from '@earendil-works/pi-ai'
import type { ScopedModel } from '@earendil-works/pi-coding-agent'

export interface CatalogRow {
	reference: string
	model: Model<Api>
	/** The session's current model. */
	isCurrent: boolean
	/** Matches the session scope (`/scoped-models`), or the scope is unrestricted. */
	isInScope: boolean
	/** Level a scope pattern pinned for this model, e.g. `:high`. */
	scopeLevel: ModelThinkingLevel | undefined
	/** Levels this model accepts, in pi's own order. */
	levels: readonly ModelThinkingLevel[]
}

export interface CatalogInput {
	available: readonly Model<Api>[]
	scoped: readonly ScopedModel[]
	current: Model<Api> | undefined
}

/** In-scope models first, the current one above them, each block alphabetical. */
function compareRows(left: CatalogRow, right: CatalogRow): number {
	if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1
	if (left.isInScope !== right.isInScope) return left.isInScope ? -1 : 1
	return left.reference.localeCompare(right.reference)
}

export function catalogRows(input: CatalogInput): CatalogRow[] {
	const scopedReferences = new Set<string>()
	const scopeLevels = new Map<string, ModelThinkingLevel>()
	for (const entry of input.scoped) {
		const reference = modelReference(entry.model)
		scopedReferences.add(reference)
		if (entry.thinkingLevel) scopeLevels.set(reference, entry.thinkingLevel)
	}
	const currentReference = input.current
		? modelReference(input.current)
		: undefined
	const rows = input.available.map(model => {
		const reference = modelReference(model)
		return {
			reference,
			model,
			isCurrent: reference === currentReference,
			// An empty scope means every available model is usable.
			isInScope: !input.scoped.length || scopedReferences.has(reference),
			scopeLevel: scopeLevels.get(reference),
			levels: getSupportedThinkingLevels(model),
		}
	})
	return rows.toSorted(compareRows)
}

/** Catalogue search: the whole reference and the model's own name. */
export function filterRows(
	rows: readonly CatalogRow[],
	query: string,
): CatalogRow[] {
	const needle = query.trim().toLowerCase()
	if (!needle) return [...rows]
	return rows.filter(row =>
		`${row.reference} ${row.model.name}`.toLowerCase().includes(needle),
	)
}

/**
 * The level a row shows, and the level enter applies: an unsaved edit first,
 * then what the session actually runs (only its own model has one), then the
 * level a scope pattern pinned. A level the model does not accept is shown as
 * no choice at all, so what the row displays is always what gets applied.
 */
export function effectiveLevel(
	row: CatalogRow,
	pendingLevel: ModelThinkingLevel | undefined,
	sessionLevel: ModelThinkingLevel | undefined,
): ModelThinkingLevel | undefined {
	const shown =
		pendingLevel ??
		(row.isCurrent ? sessionLevel : undefined) ??
		row.scopeLevel
	if (!shown || !row.levels.includes(shown)) return undefined
	return shown
}

/** Level after a left/right step, wrapping around the model's own levels. */
export function stepLevel(
	levels: readonly ModelThinkingLevel[],
	current: ModelThinkingLevel | undefined,
	delta: number,
): ModelThinkingLevel | undefined {
	if (!levels.length) return undefined
	const index = current ? levels.indexOf(current) : -1
	if (index < 0) return levels[0]
	return levels[(index + delta + levels.length) % levels.length]
}
