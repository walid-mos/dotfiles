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
import { fuzzyFilter } from '@earendil-works/pi-tui'

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

/** pi's own thinking-level names (`ModelThinkingLevel`), read from saved text. */
const THINKING_LEVEL_NAMES: readonly ModelThinkingLevel[] = [
	'off',
	'minimal',
	'low',
	'medium',
	'high',
	'xhigh',
	'max',
]

/** The stored string as a level pi knows, when it is one at all. */
export function knownLevel(
	stored: string | undefined,
): ModelThinkingLevel | undefined {
	if (!stored) return undefined
	return THINKING_LEVEL_NAMES.find(level => level === stored)
}

/** True when a saved entry is a pattern (a glob), not one model's reference. */
export function isScopePattern(entry: string): boolean {
	return /[*?]/.test(entry)
}

/** `*` and `?` inside one `/`-separated segment, every other byte literal. */
function segmentMatches(pattern: string, text: string): boolean {
	let patternIndex = 0
	let textIndex = 0
	let starIndex = -1
	let starText = 0
	while (textIndex < text.length) {
		const patternChar = pattern[patternIndex]
		if (patternChar === '?' || patternChar === text[textIndex]) {
			patternIndex += 1
			textIndex += 1
			continue
		}
		if (patternChar === '*') {
			starIndex = patternIndex
			starText = textIndex
			patternIndex += 1
			continue
		}
		if (starIndex < 0) return false
		starText += 1
		textIndex = starText
		patternIndex = starIndex + 1
	}
	while (pattern[patternIndex] === '*') patternIndex += 1
	return patternIndex === pattern.length
}

/** Both sides read as `/`-separated segments; a wildcard never crosses one. */
function globMatches(pattern: string, text: string): boolean {
	const patternSegments = pattern.split('/')
	const textSegments = text.split('/')
	if (patternSegments.length !== textSegments.length) return false
	return patternSegments.every((segment, index) =>
		segmentMatches(segment, textSegments[index] ?? ''),
	)
}

/**
 * The entry without a `:<level>` suffix pi documents (e.g. `anthropic/*:high`):
 * pi matches the entry against the catalogue and pins that level, so the
 * coverage and naming rules read the entry itself. A colon that does not end
 * in a level is part of the pattern or the model id and stays exactly.
 */
function withoutLevelSuffix(entry: string): string {
	const separator = entry.lastIndexOf(':')
	if (separator <= 0) return entry
	if (!knownLevel(entry.slice(separator + 1))) return entry
	return entry.slice(0, separator)
}

/**
 * True when a saved pattern covers one reference. pi matches each pattern with
 * minimatch against `provider/modelId` and the bare model id, after the
 * `:<level>` suffix a pattern may pin (e.g. `anthropic/*:high`) is taken off;
 * this mirrors the wildcards a model pattern uses - `*` for a run of
 * characters inside one segment, `?` for one - and reads every other
 * character literally, so a pattern this reader cannot vouch for covers
 * nothing here and the picker keeps offering the explicit pin instead of
 * claiming coverage it cannot see.
 */
export function patternCoversReference(
	pattern: string,
	reference: string,
): boolean {
	const base = withoutLevelSuffix(pattern)
	const bare = reference.slice(reference.indexOf('/') + 1)
	return globMatches(base, reference) || globMatches(base, bare)
}

/** One exact saved `enabledModels` entry: where it sits, and what it says. */
export interface ExactScopeEntry {
	index: number
	entry: string
}

/** What the saved `enabledModels` list says about one catalogue reference. */
export interface ScopeMembership {
	/** The exact saved entry naming this reference, when one does. */
	exact: ExactScopeEntry | undefined
	/** The first saved pattern covering this reference, when one does. */
	pattern: string | undefined
}

/**
 * Where each reference stands in the saved `enabledModels` list: the exact
 * entry naming it (pi's colon-suffix and bare-id rule; a bare id several
 * providers publish names none of them) and the first pattern covering it.
 */
export function scopeMemberships(
	entries: readonly string[],
	references: readonly string[],
): Map<string, ScopeMembership> {
	const memberships = new Map<string, ScopeMembership>()
	for (const reference of references)
		memberships.set(reference, { exact: undefined, pattern: undefined })
	entries.forEach((entry, index) => {
		if (isScopePattern(entry)) return coverByPattern(memberships, entry)
		const named = entryNamesReference(entry, references)
		if (!named) return
		const membership = memberships.get(named)
		if (!membership) return
		membership.exact ??= { index, entry }
	})
	return memberships
}

/** The first saved pattern that covers each reference, recorded once. */
function coverByPattern(
	memberships: Map<string, ScopeMembership>,
	pattern: string,
): void {
	for (const [reference, membership] of memberships) {
		if (!membership.pattern && patternCoversReference(pattern, reference))
			membership.pattern = pattern
	}
}

/**
 * The references a saved scope entry can name, best first: the entry itself,
 * then the entry without a `:<level>` suffix - pi's own resolver rule, which
 * keeps a model id that carries a colon (e.g. OpenRouter's `:fast`) intact. A
 * glob, or an empty entry, names no single reference.
 */
function entryCandidates(entry: string): string[] {
	const trimmed = entry.trim()
	if (!trimmed || isScopePattern(trimmed)) return []
	const base = withoutLevelSuffix(trimmed)
	return base === trimmed ? [trimmed] : [trimmed, base]
}

/**
 * The one reference a saved scope entry names, when it names one exactly: a
 * provider-qualified reference or an unambiguous bare model id. `undefined`
 * for a glob and for an id several providers publish.
 */
export function entryNamesReference(
	entry: string,
	references: readonly string[],
): string | undefined {
	for (const candidate of entryCandidates(entry)) {
		if (references.includes(candidate)) return candidate
		const byId = references.filter(
			reference =>
				reference.slice(reference.indexOf('/') + 1) === candidate,
		)
		if (byId.length === 1) return byId[0]
	}
	return undefined
}

/**
 * The session list's rows in three blocks: the current model, the scoped ones,
 * then the models the saved list names exactly (wanted from the next session
 * on, so they leave the available rest immediately), then the rest exactly as
 * the catalogue sorted it. In-scope and saved rows both follow the saved
 * `enabledModels` order: the order the scope tab saves is the order shown.
 * Rows a pattern matched, and entries this matcher cannot place, keep their
 * alphabetical seats rather than being silently expanded.
 */
export function orderScopedRows(
	rows: readonly CatalogRow[],
	entries: readonly string[],
): CatalogRow[] {
	const references = rows.map(row => row.reference)
	const rank = new Map<string, number>()
	entries.forEach((entry, index) => {
		const reference = entryNamesReference(entry, references)
		if (reference && !rank.has(reference)) rank.set(reference, index)
	})
	if (!rank.size) return [...rows]
	const bySavedOrder = (left: CatalogRow, right: CatalogRow): number =>
		(rank.get(left.reference) ?? Number.MAX_SAFE_INTEGER) -
		(rank.get(right.reference) ?? Number.MAX_SAFE_INTEGER)
	const current = rows.filter(row => row.isCurrent)
	const scoped = rows
		.filter(row => !row.isCurrent && row.isInScope)
		.toSorted(bySavedOrder)
	const saved = rows
		.filter(
			row => !row.isCurrent && !row.isInScope && rank.has(row.reference),
		)
		.toSorted(bySavedOrder)
	const available = rows.filter(
		row => !row.isCurrent && !row.isInScope && !rank.has(row.reference),
	)
	return [...current, ...scoped, ...saved, ...available]
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

/**
 * Catalogue search: pi's own fuzzy filter over the whole reference and the
 * model's own name, the same matcher pi's model selectors use. Every
 * whitespace- or slash-separated token must match somewhere in that text and
 * the best matches come first, so `codexmax` finds `gpt-5.1-codex-max` and
 * `deep flash` finds `deepseek-v4-flash`.
 */
export function filterRows(
	rows: readonly CatalogRow[],
	query: string,
): CatalogRow[] {
	if (!query.trim()) return [...rows]
	return fuzzyFilter(
		[...rows],
		query,
		row => `${row.reference} ${row.model.name}`,
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
