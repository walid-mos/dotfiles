/**
 * model-fallback - what each picker tab lists.
 *
 * One row model per tab, built from data the picker read once when it opened:
 * the key handler and the renderer walk the same rows, so a key can never act
 * on a row other than the one under the cursor.
 */

import { filterRows } from './model-catalog.ts'

import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import type { ModelFallbackConfig } from './config.ts'
import type { CatalogRow } from './model-catalog.ts'
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
	/** The saved scope patterns (`enabledModels`), when the file was readable. */
	patterns: readonly string[]
	/** False when settings.json could not be read: the patterns are unknown. */
	isSettingsReadable: boolean
	/** The live OpenRouter price list, when one has been read this session. */
	pricing: OpenRouterPricing | undefined
	config: ModelFallbackConfig
	agentPins: readonly AgentPin[]
	hasSubagentsCommand: boolean
	cooldowns: ReadonlyMap<string, number>
	now: number
}

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

export type AgentRow =
	| { kind: 'open'; isAvailable: boolean }
	| { kind: 'pin'; pin: AgentPin }

/**
 * The scope tab's rows: what the settings file saved, then what this session
 * resolved. The resolved group is the only one that describes the running
 * session - `--models` never appears in settings.json. The tab is a report:
 * pi's built-in selector owns the list and no extension can open it.
 */
export type ScopeRow =
	| { kind: 'pattern'; pattern: string }
	| { kind: 'resolved'; entry: ScopeEntry }

const TOGGLE_LABELS: Record<ToggleField, string> = {
	autoFallback: 'auto-fallback on provider failure',
	restoreOnSuccess: 'restore the original model after a clean turn',
	fastFailover: 'abort the first attempt on a 5xx',
}

function isCoolingDown(view: PickerView, reference: string): boolean {
	return (view.cooldowns.get(reference) ?? 0) > view.now
}

/**
 * The session list's scope groups: the scoped models first, then the available
 * rest, each group named by the divider above it. A session with one group (an
 * unrestricted scope, or nothing outside it) has no boundary to draw.
 */
export function scopeGroups(rows: readonly CatalogRow[]): RowGroup[] {
	const split = rows.findIndex(row => !row.isInScope)
	if (split <= 0) return []
	return [
		{ firstRow: 0, label: 'scoped' },
		{ firstRow: split, label: 'available' },
	]
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

/** The catalogue search: the whole reference and the model's own name. */
export function searchRows(
	view: PickerView,
	query: string,
): readonly CatalogRow[] {
	return filterRows(view.rows, query)
}

export function scopeRows(view: PickerView): ScopeRow[] {
	return [
		...view.patterns.map((pattern): ScopeRow => ({
			kind: 'pattern',
			pattern,
		})),
		...view.scope.map((entry): ScopeRow => ({ kind: 'resolved', entry })),
	]
}

/** The rows the active tab (or the open editor) lets a key act on. */
export function activeRowCount(input: RowCountInput): number {
	if (input.state.editor)
		return searchRows(input.view, input.editorQuery).length
	if (input.state.tab === 'session')
		return searchRows(input.view, input.query).length
	if (input.state.tab === 'fallbacks') return fallbackRows(input.view).length
	if (input.state.tab === 'agents') return agentRows(input.view).length
	return scopeRows(input.view).length
}

/**
 * Pinned agents first, the subagents action last behind a rule: the action is
 * an option, and the pinned agents are the entries a row editor acts on.
 */
export function agentRows(view: PickerView): AgentRow[] {
	return [
		...view.agentPins.map((pin): AgentRow => ({ kind: 'pin', pin })),
		{ kind: 'open', isAvailable: view.hasSubagentsCommand },
	]
}

/** The agents split: one rule above the subagents action, when pins exist. */
export function agentGroups(rows: readonly AgentRow[]): RowGroup[] {
	const firstOption = rows.findIndex(row => row.kind === 'open')
	if (firstOption <= 0) return []
	return [{ firstRow: firstOption, label: 'options' }]
}

/** The pin of one agent, when the settings file has one for it. */
export function agentPin(
	view: PickerView,
	agent: string,
): AgentPin | undefined {
	return view.agentPins.find(pin => pin.agent === agent)
}
