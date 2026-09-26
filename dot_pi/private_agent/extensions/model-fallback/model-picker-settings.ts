/**
 * model-fallback - the settings snapshot the picker displays, and the keys it
 * writes back.
 *
 * Subagent model pins belong to the `subagents` package, so the picker reads
 * them, to say which agents stopped inheriting the session model and to point
 * at the surface that edits them. The inline agent editor also writes exactly
 * one thing back: that agent's `model` and `thinking` in
 * `subagents.agentOverrides`. The scope tab edits pi's own `enabledModels`
 * setting - one entry's membership at a time or the whole list's order - and
 * owns exactly that key. Every write is a read-modify-write of the whole file
 * (every unrelated key survives, the file's own indentation and line ending
 * are kept) and lands atomically, because the subagents package reads this
 * file at launch. The scope is resolved at session start, so the writer only
 * refuses a list that changed underneath; it never pretends the running
 * session moved. A missing file cannot be written either: like a file or key
 * whose shape is not the one pi defines, it is reported as unknown and never
 * rewritten, so the picker still opens, it just does not edit what it cannot
 * read.
 */

import { join } from 'node:path'

import { getAgentDir } from '@earendil-works/pi-coding-agent'

import {
	asRecord,
	indentOf,
	newlineOf,
	parseSettingsObject,
	readSettingsText,
	writeSettingsAtomically,
} from './model-picker-settings-file.ts'

import type { AgentPin } from './model-picker-view.ts'

export interface SettingsSnapshot {
	/** False when the file could not be read parsed: nothing here is known. */
	isReadable: boolean
	/** `defaultProvider`/`defaultModel` as pi stores the startup default. */
	startupDefault: string | undefined
	/** `enabledModels`: the saved scope patterns. */
	patterns: string[]
	/** `subagents.agentOverrides`, one row per pinned agent. */
	agentPins: AgentPin[]
	/**
	 * False when `agentOverrides` carries a shape this reader cannot vouch
	 * for: the pins are unknown, never "none pinned".
	 */
	areAgentPinsKnown: boolean
}

/** An unreadable file is reported as unknown, never as "nothing configured". */
const UNREADABLE_SNAPSHOT: SettingsSnapshot = {
	isReadable: false,
	startupDefault: undefined,
	patterns: [],
	agentPins: [],
	areAgentPinsKnown: false,
}

/**
 * `enabledModels` as the string list it must be: [] when the key is absent,
 * undefined when it carries anything else, so a list this writer cannot keep
 * is refused instead of being silently shortened on the next write.
 */
function stringList(
	settings: Record<string, unknown>,
	key: string,
): string[] | undefined {
	if (!(key in settings)) return []
	const raw = settings[key]
	if (!Array.isArray(raw)) return undefined
	const entries = raw.filter(
		(entry): entry is string => typeof entry === 'string',
	)
	if (entries.length !== raw.length) return undefined
	return entries
}

/** One override key as pi defines it: its text, or a shape this reader refuses. */
type OverrideKey =
	| { kind: 'text'; value: string | undefined }
	| { kind: 'unknown' }

/** A key pi defines as a string or `false`; anything else is not that shape. */
function readOverrideKey(
	override: Record<string, unknown>,
	key: string,
): OverrideKey {
	if (!(key in override)) return { kind: 'text', value: undefined }
	const pinned = override[key]
	if (typeof pinned !== 'string' && pinned !== false)
		return { kind: 'unknown' }
	return { kind: 'text', value: pinned || undefined }
}

/**
 * The pinned agents the settings file holds. `undefined` when the shape is not
 * the one pi defines - a non-object `subagents`, `agentOverrides` or entry, or
 * an override key carrying anything but a string or `false` - so the picker
 * reports the pins as unknown instead of claiming none are pinned, and the
 * writer's own refusal stays the only thing that touches the file.
 */
function readAgentPins(
	settings: Record<string, unknown>,
): AgentPin[] | undefined {
	const subagents = asRecord(settings['subagents'])
	if ('subagents' in settings && !subagents) return undefined
	if (!(subagents && 'agentOverrides' in subagents)) return []
	const overrides = asRecord(subagents['agentOverrides'])
	if (!overrides) return undefined
	const pins: AgentPin[] = []
	for (const [agent, entry] of Object.entries(overrides)) {
		const override = asRecord(entry)
		if (!override) return undefined
		const model = readOverrideKey(override, 'model')
		const thinking = readOverrideKey(override, 'thinking')
		if (model.kind === 'unknown' || thinking.kind === 'unknown')
			return undefined
		pins.push({ agent, model: model.value, thinking: thinking.value })
	}
	return pins.toSorted((left, right) => left.agent.localeCompare(right.agent))
}

export function settingsPath(): string {
	return join(getAgentDir(), 'settings.json')
}

/**
 * The startup default as one catalogue reference: pi's `defaultModel`, prefixed
 * by `defaultProvider` when the file names one. A default pi cannot resolve to
 * a provider is still what the file says, and the header shows exactly that.
 */
function readStartupDefault(
	settings: Record<string, unknown>,
): string | undefined {
	const model = settings['defaultModel']
	if (typeof model !== 'string' || !model) return undefined
	const provider = settings['defaultProvider']
	if (typeof provider !== 'string' || !provider) return model
	return `${provider}/${model}`
}

export function readSettingsSnapshot(path = settingsPath()): SettingsSnapshot {
	const text = readSettingsText(path)
	if (!text) return UNREADABLE_SNAPSHOT
	const settings = parseSettingsObject(text)
	if (!settings) return UNREADABLE_SNAPSHOT
	const patterns = stringList(settings, 'enabledModels')
	// A list carrying entries this picker cannot keep is not the list pi
	// resolved: the saved scope is unknown, and an edit on top of it would
	// drop them.
	if (!patterns) return UNREADABLE_SNAPSHOT
	const agentPins = readAgentPins(settings)
	const startupDefault = readStartupDefault(settings)
	if (agentPins)
		return {
			isReadable: true,
			startupDefault,
			patterns,
			agentPins,
			areAgentPinsKnown: true,
		}
	return {
		isReadable: true,
		startupDefault,
		patterns,
		agentPins: [],
		areAgentPinsKnown: false,
	}
}

/** One agent's new pin: `thinking` undefined removes the key (inherit it). */
export interface AgentOverrideEdit {
	agent: string
	/** The model to pin; omitted to leave the agent's own `model` key alone. */
	model?: string
	thinking: string | undefined
}

/** A key that must stay an object if it is there at all: never clobber it. */
function nestedRecord(
	parent: Record<string, unknown>,
	key: string,
	what: string,
): Record<string, unknown> {
	const candidate = parent[key]
	if (!candidate) return {}
	const record = asRecord(candidate)
	if (!record)
		throw new Error(`${what} is not an object; refusing to rewrite it`)
	return record
}

/** The whole settings object with one agent's pin merged into place. */
export function mergeAgentOverride(
	settings: Record<string, unknown>,
	edit: AgentOverrideEdit,
): Record<string, unknown> {
	const subagents = { ...nestedRecord(settings, 'subagents', 'subagents') }
	const overrides = {
		...nestedRecord(
			subagents,
			'agentOverrides',
			'subagents.agentOverrides',
		),
	}
	const entry = {
		...nestedRecord(
			overrides,
			edit.agent,
			`subagents.agentOverrides.${edit.agent}`,
		),
	}
	// A reasoning-only edit must never turn an inherited model into a pin: the
	// `model` key stays exactly as the file had it, `false` included.
	if (edit.model) entry['model'] = edit.model
	if (edit.thinking) entry['thinking'] = edit.thinking
	else delete entry['thinking']
	overrides[edit.agent] = entry
	subagents['agentOverrides'] = overrides
	return { ...settings, subagents }
}

/**
 * Persist one agent override: read the file, merge the pin, write it back. An
 * unreadable or malformed file throws instead of being replaced - the picker
 * reports that and leaves the file alone.
 */
export function writeAgentOverride(
	path: string,
	edit: AgentOverrideEdit,
): void {
	const text = readSettingsText(path)
	if (!text) throw new Error(`${path} could not be read`)
	const settings = parseSettingsObject(text)
	if (!settings) throw new Error(`${path} is not a JSON object`)
	const next = mergeAgentOverride(settings, edit)
	writeSettingsAtomically(path, next, indentOf(text), newlineOf(text))
}

/** What one saved-list edit did, so the notice that reports it can name it. */
export type ScopeListChange =
	| { kind: 'reordered' }
	| { kind: 'added'; entry: string }
	| { kind: 'removed'; entry: string }

/** One edit of the saved scope: the list the picker read and the list to save. */
export interface ScopeListEdit {
	expected: readonly string[]
	next: readonly string[]
	change: ScopeListChange
}

/** The same entries in the same order: the file the picker read is intact. */
function sameList(left: readonly string[], right: readonly string[]): boolean {
	if (left.length !== right.length) return false
	return left.every((entry, index) => entry === right[index])
}

/** One default-model save: the reference the highlighted row showed. */
export interface DefaultModelEdit {
	reference: string
}

/**
 * One catalogue reference as pi stores a startup default: `provider/modelId`
 * splits into `defaultProvider` and `defaultModel`, the two keys pi's own
 * `/model` picker writes with the same key. A bare id names no provider, so the
 * provider key is left exactly as the file had it.
 */
function splitReference(reference: string): {
	provider: string | undefined
	model: string
} {
	const slash = reference.indexOf('/')
	if (slash <= 0) return { provider: undefined, model: reference }
	return {
		provider: reference.slice(0, slash),
		model: reference.slice(slash + 1),
	}
}

/**
 * Persist the startup default: what the next session starts on, in pi's own
 * `defaultProvider`/`defaultModel`. Returns whether the file changed - a save
 * of the default already in place writes nothing and says so - and every other
 * settings key is preserved.
 */
export function writeDefaultModel(
	path: string,
	edit: DefaultModelEdit,
): boolean {
	const text = readSettingsText(path)
	if (!text) throw new Error(`${path} could not be read`)
	const settings = parseSettingsObject(text)
	if (!settings) throw new Error(`${path} is not a JSON object`)
	const { provider, model } = splitReference(edit.reference)
	const isProviderSaved = !provider || settings.defaultProvider === provider
	if (settings.defaultModel === model && isProviderSaved) return false
	const next: Record<string, unknown> = { ...settings, defaultModel: model }
	if (provider) next.defaultProvider = provider
	writeSettingsAtomically(path, next, indentOf(text), newlineOf(text))
	return true
}

/**
 * Persist one edit of the saved scope - a reorder, an addition or a removal.
 * The picker edits the entries it read; if `enabledModels` changed in the
 * meantime (pi's own selector, an editor) the write refuses rather than
 * replacing a list nobody asked it to touch, and no other settings key is
 * rewritten.
 */
export function writeEnabledModels(path: string, edit: ScopeListEdit): void {
	const text = readSettingsText(path)
	if (!text) throw new Error(`${path} could not be read`)
	const settings = parseSettingsObject(text)
	if (!settings) throw new Error(`${path} is not a JSON object`)
	const current = stringList(settings, 'enabledModels')
	if (!current)
		throw new Error(
			'enabledModels is not a list of strings; refusing to rewrite it',
		)
	if (!sameList(current, edit.expected))
		throw new Error('enabledModels changed while the picker was open')
	writeSettingsAtomically(
		path,
		{ ...settings, enabledModels: [...edit.next] },
		indentOf(text),
		newlineOf(text),
	)
}
