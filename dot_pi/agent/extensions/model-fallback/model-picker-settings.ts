/**
 * model-fallback - the settings snapshot the picker displays, and the one key
 * it owns.
 *
 * Subagent model pins belong to the `subagents` package, so the picker reads
 * them, to say which agents stopped inheriting the session model and to point
 * at the surface that edits them. The inline agent editor also writes exactly
 * one thing back: that agent's `model` and `thinking` in
 * `subagents.agentOverrides`. The write is a read-modify-write of the whole
 * file (every unrelated key survives, the file's own indentation is kept) and
 * it lands atomically, because the subagents package reads this file at launch.
 * The scope patterns are pi's own `enabledModels` setting, resolved at session
 * start; the picker only shows them, so the scope tab can explain what this
 * session is limited to. A missing or unreadable settings file is an empty
 * snapshot, never an error: the picker still opens.
 */

import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { getAgentDir } from '@earendil-works/pi-coding-agent'

import type { AgentPin } from './model-picker-view.ts'

export interface SettingsSnapshot {
	/** False when the file could not be read parsed: nothing here is known. */
	isReadable: boolean
	/** `enabledModels`: the saved scope patterns. */
	patterns: string[]
	/** `subagents.agentOverrides`, one row per pinned agent. */
	agentPins: AgentPin[]
}

/** An unreadable file is reported as unknown, never as "nothing configured". */
const UNREADABLE_SNAPSHOT: SettingsSnapshot = {
	isReadable: false,
	patterns: [],
	agentPins: [],
}

function asRecord(candidate: unknown): Record<string, unknown> | undefined {
	if (typeof candidate !== 'object' || candidate === null) return undefined
	// oxlint-disable-next-line nextnode/no-type-assertion
	return candidate as Record<string, unknown>
}

function stringList(patterns: unknown): string[] {
	if (!Array.isArray(patterns)) return []
	return patterns.filter(
		(entry): entry is string => typeof entry === 'string',
	)
}

function optionalString(pinned: unknown): string | undefined {
	if (typeof pinned !== 'string') return undefined
	return pinned || undefined
}

function readAgentPins(settings: Record<string, unknown>): AgentPin[] {
	const overrides = asRecord(
		asRecord(settings['subagents'])?.['agentOverrides'],
	)
	if (!overrides) return []
	return Object.entries(overrides)
		.map(([agent, agentOverride]) => {
			const pin = asRecord(agentOverride) ?? {}
			return {
				agent,
				model: optionalString(pin['model']),
				thinking: optionalString(pin['thinking']),
			}
		})
		.toSorted((left, right) => left.agent.localeCompare(right.agent))
}

export function settingsPath(): string {
	return join(getAgentDir(), 'settings.json')
}

function readText(path: string): string | undefined {
	try {
		return readFileSync(path, 'utf8')
	} catch {
		return undefined
	}
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text)
	} catch {
		return undefined
	}
}

export function readSettingsSnapshot(path = settingsPath()): SettingsSnapshot {
	const text = readText(path)
	if (!text) return UNREADABLE_SNAPSHOT
	const settings = asRecord(parseJson(text))
	if (!settings) return UNREADABLE_SNAPSHOT
	return {
		isReadable: true,
		patterns: stringList(settings['enabledModels']),
		agentPins: readAgentPins(settings),
	}
}

/** One agent's new pin: `thinking` undefined removes the key (inherit it). */
export interface AgentOverrideEdit {
	agent: string
	model: string
	thinking: string | undefined
}

/** A settings file with no indentation to copy gets pi's own two spaces. */
const DEFAULT_INDENT = '  '

/** The indentation the file already uses, so a rewrite is not a reflow. */
function indentOf(text: string): string {
	for (const line of text.split('\n')) {
		const indent = /^([\t ]+)\S/.exec(line)?.[1]
		if (indent) return indent
	}
	return DEFAULT_INDENT
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
	entry['model'] = edit.model
	if (edit.thinking) entry['thinking'] = edit.thinking
	else delete entry['thinking']
	overrides[edit.agent] = entry
	subagents['agentOverrides'] = overrides
	return { ...settings, subagents }
}

/** Write to a sibling and rename, so a reader never sees a half-written file. */
function writeAtomically(path: string, text: string): void {
	const temporary = `${path}.${String(process.pid)}.tmp`
	try {
		writeFileSync(temporary, text, 'utf8')
		renameSync(temporary, path)
	} catch (error) {
		rmSync(temporary, { force: true })
		throw error
	}
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
	const text = readText(path)
	if (!text) throw new Error(`${path} could not be read`)
	const settings = asRecord(parseJson(text))
	if (!settings) throw new Error(`${path} is not a JSON object`)
	const next = mergeAgentOverride(settings, edit)
	writeAtomically(path, `${JSON.stringify(next, null, indentOf(text))}\n`)
}
