/** Context budget reading for the footer's context gauge: the gauge shows the
 * saved budget as its share of the model window, so the footer rereads
 * `context-budget.json` only when the settings file changes (versioned stat
 * key from the shared model). Pure caching, no IO beyond one stat per read;
 * module state belongs to this extension's own module registry. */
import {
	checkpointSettingsVersion,
	checkpointWindowCap,
	readCheckpointSettings,
} from '#lib/context-budget/model.ts'

export type FooterBudget = {
	/** Effective ceiling: the configured limit under the model-window cap. */
	limit: number
	/** The same model window the usage gauge is measured against. */
	window: number
}

// Only a successful read renews the version, so a missing or invalid settings
// file retries on its next render instead of sticking undefined forever.
let cachedVersion: string | null = null
let configuredLimit: number | undefined

function configuredBudgetLimit(): number | undefined {
	const version = checkpointSettingsVersion()
	if (version === cachedVersion) return configuredLimit
	try {
		const limit = readCheckpointSettings().maxContextTokens
		configuredLimit = limit
		cachedVersion = version
		return limit
	} catch {
		// An unreadable settings file renders no budget segment: the version is
		// absent until the file exists again, so nothing is re-read meanwhile.
	}
	return undefined
}

/**
 * The budget the footer renders for this model window, or nothing while
 * there is no anchor: no readable settings or no model window. The saved
 * limit is a validated positive integer, so truthiness is exact here.
 */
export function footerBudget(
	contextWindow: number | undefined,
): FooterBudget | undefined {
	const limit = configuredBudgetLimit()
	if (!limit) return undefined
	if (
		typeof contextWindow !== 'number' ||
		!Number.isFinite(contextWindow) ||
		contextWindow <= 0
	)
		return undefined
	return {
		limit: Math.min(limit, checkpointWindowCap(contextWindow)),
		window: contextWindow,
	}
}
