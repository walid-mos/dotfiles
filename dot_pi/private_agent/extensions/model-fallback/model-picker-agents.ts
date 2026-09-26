/**
 * model-fallback - the agents tab's rows: one entry per agent the picker can
 * pin, merged from the pins this extension owns and the roster the `subagents`
 * package publishes.
 *
 * The merge is what makes a row honest: a pin is a settings fact, the roster is
 * a definition fact, and the row says which one supplies the model
 * (`pin`, `agent`, `default`) and which model is left (`session`). An agent only
 * a pin names stays listed, marked, so a pin outlived by its agent is visible
 * instead of silently doing nothing.
 */

import { clampThinkingLevel } from '@earendil-works/pi-ai'

import { knownLevel } from './model-catalog.ts'

import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import type { RosterAgent } from './agent-roster.ts'
import type { CatalogRow } from './model-catalog.ts'
import type { AgentPin, PickerView, RowGroup } from './model-picker-view.ts'

/**
 * Where an agent's model comes from. `pin` and `default` are settings the
 * picker can edit, `agent` is the agent definition's own frontmatter, and
 * `session` is inheritance from the running session.
 */
export type AgentModelOrigin = 'pin' | 'agent' | 'default' | 'session' | 'none'

/**
 * One agent the picker can pin: the fact the `subagents` package reports (its
 * own definition and configured model) merged with the pin this picker owns.
 * An agent only a pin names (`isKnown: false`) is still listed, so a pin left
 * behind by a removed agent is visible instead of silently doing nothing.
 */
export interface AgentEntry {
	name: string
	/** The stored pin, when the settings file has one: what the editor writes. */
	pin: AgentPin | undefined
	/** False when no agent definition matches this name any more. */
	isKnown: boolean
	/** The model this agent would run, inheritance included. */
	model: string | undefined
	modelOrigin: AgentModelOrigin
	/** The settings scope a pin or a `subagents.defaultModel` came from. */
	modelScope: 'user' | 'project' | undefined
	/** The level this agent would run: its pin's, else its own definition's. */
	thinking: string | undefined
	thinkingOrigin: 'pin' | 'agent' | undefined
	/** The agent definition's own description, when the roster reports one. */
	description: string | undefined
	/** `builtin`, `package`, `user` or `project`, when the roster knows. */
	source: string | undefined
}

/** One agents-tab row: one agent, or the subagents action at the end. */
export type AgentRow =
	| { kind: 'open'; isAvailable: boolean }
	| { kind: 'agent'; entry: AgentEntry }

/** Where an agent's configured model comes from, as one word. */
function configuredOrigin(agent: RosterAgent): AgentModelOrigin {
	if (!(agent.modelOrigin === 'default')) return 'agent'
	return 'default'
}

/** One roster agent, with the picker's own pin merged over it. */
function entryFromRoster(
	view: PickerView,
	agent: RosterAgent,
	pin: AgentPin | undefined,
): AgentEntry {
	const pinned = Boolean(pin?.model)
	// The pin wins over the definition, and the session's model is the last
	// resort: an agent that configures nothing runs what the session runs.
	let origin: AgentModelOrigin = 'none'
	if (pinned) origin = 'pin'
	else if (agent.model) origin = configuredOrigin(agent)
	else if (view.currentReference) origin = 'session'
	const thinking = pin?.thinking ?? agent.thinking
	let thinkingOrigin: AgentEntry['thinkingOrigin']
	if (pin?.thinking) thinkingOrigin = 'pin'
	else if (thinking) thinkingOrigin = 'agent'
	return {
		name: agent.name,
		pin,
		isKnown: true,
		model: pin?.model ?? agent.model ?? view.currentReference,
		modelOrigin: origin,
		modelScope: pinned ? 'user' : agent.modelScope,
		thinking,
		thinkingOrigin,
		description: agent.description || undefined,
		source: agent.source,
	}
}

/** One pinned agent without a roster entry: the package could not vouch for it. */
function entryFromPin(
	view: PickerView,
	pin: AgentPin,
	isKnown: boolean,
): AgentEntry {
	let origin: AgentModelOrigin = 'none'
	if (pin.model) origin = 'pin'
	else if (view.currentReference) origin = 'session'
	return {
		name: pin.agent,
		pin,
		isKnown,
		model: pin.model ?? view.currentReference,
		modelOrigin: origin,
		modelScope: pin.model ? 'user' : undefined,
		thinking: pin.thinking,
		thinkingOrigin: pin.thinking ? 'pin' : undefined,
		description: undefined,
		source: undefined,
	}
}

/**
 * The rows the agents tab lists: every agent the roster reports, every pinned
 * agent the roster does not know, and - when the package answered nothing - the
 * pinned agents alone, which is all this extension can read by itself. The two
 * sources merge on the agent's name; the list is sorted by name so a row keeps
 * its seat as agents appear and pins change.
 */
export function agentEntries(view: PickerView): AgentEntry[] {
	const pins = new Map(view.agentPins.map(pin => [pin.agent, pin]))
	const entries: AgentEntry[] = []
	for (const agent of view.roster ?? []) {
		const pin = pins.get(agent.name)
		pins.delete(agent.name)
		entries.push(entryFromRoster(view, agent, pin))
	}
	// A pin whose agent no longer exists: listed, marked, and still editable so
	// it can be repointed at an agent that does.
	for (const pin of pins.values())
		entries.push(entryFromPin(view, pin, false))
	return entries.toSorted((left, right) =>
		left.name.localeCompare(right.name),
	)
}

/** The entry of one agent, when the agents tab lists it. */
export function agentEntry(
	view: PickerView,
	agent: string,
): AgentEntry | undefined {
	return agentEntries(view).find(entry => entry.name === agent)
}

/**
 * The model the inline editor's cursor opens on: the pinned model, or - for an
 * agent this picker has never pinned - the model its own definition names, so
 * the cursor never starts on an unrelated model.
 */
export function editorAnchor(entry: AgentEntry): string | undefined {
	if (entry.pin?.model) return entry.pin.model
	if (!(entry.modelOrigin === 'agent' || entry.modelOrigin === 'default'))
		return undefined
	return entry.model
}

/**
 * The catalogue row an agent's effective model is, when the catalogue lists it:
 * what the reasoning column and the editor read, so a model the catalogue
 * cannot resolve reads as unknown there instead of inventing levels.
 */
export function agentModelRow(
	view: PickerView,
	model: string | undefined,
): CatalogRow | undefined {
	if (!model) return undefined
	return view.rows.find(row => row.reference === model)
}

/**
 * The level an agent's thinking override actually runs at: the stored value
 * clamped to the model it will run on (pi clamps every non-reasoning model to
 * `off` and every unsupported level to the nearest one the model accepts), so
 * the column never claims a level the model cannot take. `undefined` when the
 * agent sets no level of its own and runs the model's default instead.
 */
export function agentLevel(
	entry: AgentEntry,
	row: CatalogRow | undefined,
): ModelThinkingLevel | undefined {
	const stored = knownLevel(entry.thinking)
	if (!stored || !row) return undefined
	return clampThinkingLevel(row.model, stored)
}

/**
 * The rows the agents tab lets a key act on: the entries, then the subagents
 * action, which is an option like the fallbacks tab's toggles.
 */
export function agentRows(view: PickerView): AgentRow[] {
	return [
		...agentEntries(view).map((entry): AgentRow => ({
			kind: 'agent',
			entry,
		})),
		{ kind: 'open', isAvailable: view.hasSubagentsCommand },
	]
}

/** The agents split: one rule above the subagents action, when entries exist. */
export function agentGroups(rows: readonly AgentRow[]): RowGroup[] {
	const firstOption = rows.findIndex(row => row.kind === 'open')
	if (firstOption <= 0) return []
	return [{ firstRow: firstOption, label: 'options' }]
}
