// Persisted model-fallback configuration: the fallback chain, the auto-failover
// toggles, and how long a failed model stays cooling down. The TypeBox schema is
// the single source of truth for both runtime validation and the TypeScript
// type, so a half-valid config can never reach the failover path.
// Unit-tested in `../tests/model-fallback.test.ts`.

import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { getAgentDir } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

import type { Static } from 'typebox'

/** `provider/modelId` - the model id may itself contain slashes (see `chain.ts`). */
const MODEL_REFERENCE_PATTERN = '^[^/:]+/.+$'
const MIN_EXCLUSION_TTL_MS = 1_000
const DEFAULT_EXCLUSION_TTL_MS = 300_000

export const ModelFallbackConfigSchema = Type.Object({
	autoFallback: Type.Boolean({
		default: true,
		description: 'Move the session to the next chain model after a failure',
	}),
	restoreOnSuccess: Type.Boolean({
		default: true,
		description: 'Return to the original model after a clean turn',
	}),
	fastFailover: Type.Boolean({
		default: true,
		description: 'Abort the first attempt on a 5xx instead of retrying it',
	}),
	exclusionTtlMs: Type.Number({
		minimum: MIN_EXCLUSION_TTL_MS,
		default: DEFAULT_EXCLUSION_TTL_MS,
		description: 'How long a failed model stays out of the chain',
	}),
	chain: Type.Array(Type.String({ pattern: MODEL_REFERENCE_PATTERN }), {
		default: [],
		uniqueItems: true,
		description: 'Models tried in order, after the current session model',
	}),
})

export type ModelFallbackConfig = Static<typeof ModelFallbackConfigSchema>

/** Fresh defaults; the chain is a new array every call, never a shared one. */
export function defaultConfig(): ModelFallbackConfig {
	return parseConfig({})
}

export function configPath(): string {
	return join(getAgentDir(), 'extensions', 'model-fallback', 'config.json')
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

/** Throws on any malformed field, naming the offending path. */
export function parseConfig(raw: unknown): ModelFallbackConfig {
	const filled = Value.Default(ModelFallbackConfigSchema, raw)
	// `Check` is what narrows the defaulted value to the schema's own type.
	if (Value.Check(ModelFallbackConfigSchema, filled)) return filled
	throw new Error(violationsOf(filled))
}

/** One message per offending field, each naming its own path. */
function violationsOf(invalidConfig: unknown): string {
	return [...Value.Errors(ModelFallbackConfigSchema, invalidConfig)]
		.map(error => `${error.instancePath || '/'} ${error.message}`)
		.join('; ')
}

function isMissingFileError(error: unknown): boolean {
	return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** A missing file is not a failure: the extension runs on defaults. */
export function loadConfig(path: string): ModelFallbackConfig {
	let text: string
	try {
		text = readFileSync(path, 'utf8')
	} catch (error) {
		if (isMissingFileError(error)) return defaultConfig()
		throw error
	}
	try {
		return parseConfig(JSON.parse(text))
	} catch (error) {
		throw new Error(
			`invalid model-fallback config at ${path}: ${errorMessage(error)}`,
			{ cause: error },
		)
	}
}

export function saveConfig(path: string, config: ModelFallbackConfig): void {
	const temporaryPath = `${path}.tmp`
	writeFileSync(temporaryPath, `${JSON.stringify(config, null, '\t')}\n`)
	renameSync(temporaryPath, path)
}
