/**
 * model-fallback - the inline agent editor's row list: the explicit
 * no-model-change row an agent with no model row to open on starts from, then
 * the catalogue matches behind it.
 *
 * An agent can have no row of its own to sit on: a stored thinking level with
 * no model, or a model the catalogue does not list. Without this row the cursor
 * would land on the first match and enter would silently pin it - deleting the
 * stored level on the way. The row makes "change nothing" a real, selectable
 * state; a search hides it, and an agent with an anchor row never sees it.
 */

import { filterRows } from './model-catalog.ts'

import type { CatalogRow } from './model-catalog.ts'

/** One editor row: the no-model-change row, or one model to pin. */
export type EditorRow = { kind: 'keep' } | { kind: 'model'; row: CatalogRow }

/** True when the catalogue can show this model as a row to open the editor on. */
export function hasAnchorRow(
	anchor: string | undefined,
	rows: readonly CatalogRow[],
): boolean {
	if (!anchor) return false
	return rows.some(row => row.reference === anchor)
}

/**
 * The editor's rows: the no-model-change row first while the agent has no
 * anchor row and the search is empty, then every matching model. A search hides
 * it, so typing narrows to real models and enter pins the one under the cursor
 * - a deliberate choice, not the cursor's opening position.
 */
export function editorRows(input: {
	/** The whole catalogue, the same rows every tab was built from. */
	rows: readonly CatalogRow[]
	/** The model the cursor opens on: the pin, else the agent's own model. */
	anchor: string | undefined
	query: string
}): EditorRow[] {
	const models = filterRows(input.rows, input.query).map(
		(row): EditorRow => ({ kind: 'model', row }),
	)
	if (input.query.trim() || hasAnchorRow(input.anchor, input.rows))
		return models
	return [{ kind: 'keep' }, ...models]
}
