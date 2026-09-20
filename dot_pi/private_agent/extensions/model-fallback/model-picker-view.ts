/**
 * model-fallback - what each picker tab lists.
 *
 * One row model per tab, built from data the picker read once when it opened:
 * the key handler and the renderer walk the same rows, so a key can never act
 * on a row other than the one under the cursor. The fallbacks tab's rows live
 * in `model-picker-fallbacks.ts`, the scope tab's in `model-picker-scope-rows.ts`
 * and the agents tab's in `model-picker-agents.ts`; this module owns the view
 * they are built from and the session catalogue itself.
 */

import {
	filterRows,
	orderScopedRows,
	scopeMemberships,
} from './model-catalog.ts'
import { agentEntry, agentRows, editorAnchor } from './model-picker-agents.ts'
import { editorRows } from './model-picker-editor-rows.ts'
import { fallbackRows } from './model-picker-fallbacks.ts'
import { scopeRows } from './model-picker-scope-rows.ts'
import { CTRL_P_LIST } from './model-picker-words.ts'

import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import type { RosterAgent } from './agent-roster.ts'
import type { ModelFallbackConfig } from './config.ts'
import type { CatalogRow, ScopeMembership } from './model-catalog.ts'
import type { PickerState } from './model-picker-state.ts'
import type { OpenRouterPricing } from './openrouter-pricing.ts'

/** A model the session scope resolved to, as `/scoped-models` reports it. */
export interface ScopeEntry {
	reference: string
	level: ModelThinkingLevel | undefined
	isCurrent: boolean
}

/** One agent's pinned model, read from the settings the package owns. */
export interface AgentPin {
	agent: string
	model: string | undefined
	thinking: string | undefined
}

/** A labeled boundary between row groups: the divider draws above `firstRow`. */
export interface RowGroup {
	firstRow: number
	label: string
}

/** One rendered line; `pick` marks the tab row a click on this line selects. */
export interface PickerLine {
	text: string
	pick?: number
}

export interface PickerSize {
	width: number
	height: number
}

/** What a key acts on: the active tab's rows, with no layout involved. */
export interface RowCountInput {
	view: PickerView
	state: PickerState
	/** The search text the picker's session input holds right now. */
	query: string
	/** The search text the inline agent editor's input holds right now. */
	editorQuery: string
}

/** The search the picker is filtering with right now. */
export function activeQuery(input: RowCountInput): string {
	if (input.state.editor) return input.editorQuery
	return input.state.tab === 'session' ? input.query : ''
}

export interface RenderInput extends RowCountInput {
	size: PickerSize
	/** The search line the input rendered, spliced in verbatim. */
	searchLine: string
}

export interface PickerView {
	/** The whole available catalogue, already sorted. */
	rows: readonly CatalogRow[]
	currentReference: string | undefined
	sessionLevel: ModelThinkingLevel | undefined
	scope: readonly ScopeEntry[]
	/** No scope is configured, so every available model is usable. */
	isScopeUnrestricted: boolean
	/** The startup default new sessions begin on, when the file names one. */
	startupDefault: string | undefined
	/** The saved scope patterns (`enabledModels`), when the file was readable. */
	patterns: readonly string[]
	/** False when settings.json could not be read: the patterns are unknown. */
	isSettingsReadable: boolean
	/** The live OpenRouter price list, when one has been read this session. */
	pricing: OpenRouterPricing | undefined
	config: ModelFallbackConfig
	/** The pins `subagents.agentOverrides` holds, as the settings file has them. */
	agentPins: readonly AgentPin[]
	/**
	 * False when the pins could not be read: what the agents tab shows is
	 * unknown, not empty.
	 */
	areAgentPinsKnown: boolean
	/** The agents the `subagents` package reports, or `undefined` when it did
	 * not answer: the pins alone are then all this extension can see. */
	roster: readonly RosterAgent[] | undefined
	hasSubagentsCommand: boolean
	cooldowns: ReadonlyMap<string, number>
	now: number
}

/**
 * The session list's groups: the models the running session cycles, then the
 * models the list names exactly (they are wanted from the next session on,
 * which the `in Ctrl+P list next session` divider says), then the rest. A list
 * with one group (an unrestricted scope, or nothing outside it) has no boundary
 * to draw.
 */
export function scopeGroups(
	rows: readonly CatalogRow[],
	isSavedEntry: (reference: string) => boolean,
): RowGroup[] {
	const groups: RowGroup[] = []
	rows.forEach((row, index) => {
		let label = 'available'
		if (row.isInScope) label = `in ${CTRL_P_LIST} now`
		else if (isSavedEntry(row.reference))
			label = `in ${CTRL_P_LIST} next session`
		if (groups.at(-1)?.label !== label)
			groups.push({ firstRow: index, label })
	})
	return groups.length > 1 ? groups : []
}

/**
 * Where every catalogue reference stands in the saved `enabledModels` list.
 * The session scope is a session fact (pi resolved it at start) while this is
 * the saved list's own membership: a model a pattern covers is saved, even
 * when no single entry spells its id out.
 */
export function savedScope(view: PickerView): Map<string, ScopeMembership> {
	return scopeMemberships(
		view.patterns,
		view.rows.map(row => row.reference),
	)
}

/** The catalogue search: pi's own fuzzy filter, over `filterRows`. */
export function searchRows(
	view: PickerView,
	query: string,
): readonly CatalogRow[] {
	return filterRows(view.rows, query)
}

/**
 * The session tab's rows: the entire catalogue search, in the saved scope
 * order, so the `scoped` group shows the order the scope tab has saved.
 */
export function sessionRows(
	view: PickerView,
	query: string,
): readonly CatalogRow[] {
	return orderScopedRows(searchRows(view, query), view.patterns)
}

/** The rows the active tab (or the open editor) lets a key act on. */
export function activeRowCount(input: RowCountInput): number {
	if (input.state.editor) {
		const entry = agentEntry(input.view, input.state.editor.agent)
		return editorRows({
			rows: input.view.rows,
			anchor: entry ? editorAnchor(entry) : undefined,
			query: input.editorQuery,
		}).length
	}
	if (input.state.tab === 'session')
		return sessionRows(input.view, input.query).length
	if (input.state.tab === 'fallbacks') return fallbackRows(input.view).length
	if (input.state.tab === 'agents') return agentRows(input.view).length
	return scopeRows(input.view).length
}
