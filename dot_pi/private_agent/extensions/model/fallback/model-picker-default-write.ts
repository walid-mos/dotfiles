/**
 * fallback - the session tab's ctrl+s write: pi's startup default, one
 * read-modify-write at a time.
 *
 * The model lands in pi's own `defaultProvider`/`defaultModel`, the two keys
 * pi's own `/model` picker writes with the same key. When the edit carries
 * the row's stepped reasoning level, it is stored in
 * `modelThinkingLevels[provider/modelId]`, the entry a new session starts
 * that model at, per model, ahead of the global thinking default. A level
 * beside a provider-less model id is refused (pi names no entry to read it
 * from), a `modelThinkingLevels` whose stored shape is not the map pi
 * defines is refused, never replaced or pruned, and every other settings
 * key survives. A save of the default already in place, at the same level,
 * writes nothing.
 */

import {
	asRecord,
	indentOf,
	newlineOf,
	parseSettingsObject,
	readSettingsText,
	writeSettingsAtomically,
} from './model-picker-settings-file.ts'

import type { ModelThinkingLevel } from '@earendil-works/pi-ai'

/** One default-model save: the reference (and stepped level) the row showed. */
export interface DefaultModelEdit {
	reference: string
	/** The row's stepped level, or none: keep whatever the model inherits. */
	level: ModelThinkingLevel | undefined
}

/**
 * One catalogue reference as pi stores a startup default: `provider/modelId`
 * splits into the two keys. A bare id names no provider, so the provider key
 * is left exactly as the file had it.
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

/** The `modelThinkingLevels` object with `levelKey` set; a malformed one refuses. */
function mergedModelLevels(
	settings: Record<string, unknown>,
	levelKey: string,
	level: ModelThinkingLevel,
): Record<string, unknown> {
	const levels = asRecord(settings['modelThinkingLevels'])
	if (!levels && 'modelThinkingLevels' in settings)
		throw new Error(
			'modelThinkingLevels is not an object; refusing to rewrite it',
		)
	return { ...levels, [levelKey]: level }
}

/** The file already names this default at this level: the save is a no-op. */
function defaultAlreadySaved(
	settings: Record<string, unknown>,
	edit: DefaultModelEdit,
): boolean {
	const { provider, model } = splitReference(edit.reference)
	if (settings.defaultModel !== model) return false
	if (provider && settings.defaultProvider !== provider) return false
	if (!edit.level) return true
	const levelKey = provider ? `${provider}/${model}` : undefined
	if (!levelKey) return false
	return asRecord(settings['modelThinkingLevels'])?.[levelKey] === edit.level
}

/**
 * Persist the startup default: pi's `defaultProvider`/`defaultModel`, and the
 * model's `modelThinkingLevels` entry when the edit carries a stepped level -
 * the value a new session starts that model at. Every other key survives; a
 * save of the default already in place, at the same level, writes nothing.
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
	const levelKey = provider ? `${provider}/${model}` : undefined
	if (edit.level && !levelKey)
		throw new Error(
			`${edit.reference} names no provider; cannot save a reasoning level without one`,
		)
	if (defaultAlreadySaved(settings, edit)) return false
	const next: Record<string, unknown> = { ...settings, defaultModel: model }
	if (provider) next.defaultProvider = provider
	if (levelKey && edit.level)
		next['modelThinkingLevels'] = mergedModelLevels(
			settings,
			levelKey,
			edit.level,
		)
	writeSettingsAtomically(path, next, indentOf(text), newlineOf(text))
	return true
}
