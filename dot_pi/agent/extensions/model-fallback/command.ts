/**
 * model-fallback - the `/models` command (alias `/fallback`) and the persisted
 * config it writes.
 *
 * `status` reports the toggles, the chain and the cooldowns, `on` and `off`
 * flip auto-fallback, and every other argument opens the unified picker. The
 * file on disk is what the next session reads, so each change is written as
 * soon as it is made, and a write that fails is reported rather than hidden.
 */

import { configPath, saveConfig } from './config.ts'
import { currentModelReference } from './failover.ts'
import { createOpenRouterPricingSource } from './openrouter-pricing.ts'
import { formatFallbackStatus, openModelPicker } from './picker.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { AutocompleteItem } from '@earendil-works/pi-tui'
import type { ModelFallbackConfig } from './config.ts'
import type { FallbackSession } from './fallback-session.ts'
import type { OpenRouterPricingSource } from './openrouter-pricing.ts'
import type { PickerDeps } from './picker.ts'

const FALLBACK_ACTIONS = ['status', 'menu', 'on', 'off']

/** Only the fixed actions complete; anything else opens the menu. */
function argumentCompletions(prefix: string): AutocompleteItem[] | null {
	const matches = FALLBACK_ACTIONS.filter(action => action.startsWith(prefix))
	if (!matches.length) return null
	return matches.map(action => ({ value: action, label: action }))
}

function statusText(ctx: ExtensionContext, session: FallbackSession): string {
	return formatFallbackStatus(
		session.currentConfig(),
		currentModelReference(ctx),
		session.currentCooldowns(),
		Date.now(),
	)
}

/** The config the user just changed: in memory now, on disk for the next run. */
function persistConfig(
	ctx: ExtensionContext,
	session: FallbackSession,
	next: ModelFallbackConfig,
): void {
	session.setConfig(next)
	try {
		saveConfig(configPath(), next)
	} catch (error) {
		ctx.ui.notify(
			`model-fallback: cannot write ${configPath()}: ${String(error)}`,
			'error',
		)
	}
}

/** The dependencies one picker run needs; the session owns the config they read. */
function pickerDeps(
	pi: ExtensionAPI,
	session: FallbackSession,
	ctx: ExtensionContext,
	pricing: OpenRouterPricingSource,
): PickerDeps {
	return {
		pi,
		getConfig: () => session.currentConfig(),
		setConfig: (next: ModelFallbackConfig) =>
			persistConfig(ctx, session, next),
		getCooldowns: () => session.currentCooldowns(),
		pricing,
	}
}

export function registerFallbackCommand(
	pi: ExtensionAPI,
	session: FallbackSession,
): void {
	// One live price list per session: the first `/models` reads it, later opens
	// read the same list, and a failed read leaves the catalog in place.
	const pricing = createOpenRouterPricingSource()
	const handler = async (
		args: string,
		ctx: ExtensionContext,
	): Promise<void> => {
		const action = args.trim()
		if (action === 'on' || action === 'off') {
			const isEnabled = action === 'on'
			persistConfig(ctx, session, {
				...session.currentConfig(),
				autoFallback: isEnabled,
			})
			ctx.ui.notify(
				`Auto-fallback ${isEnabled ? 'enabled' : 'disabled'}.`,
				'info',
			)
			return
		}
		if (action === 'status') {
			ctx.ui.notify(statusText(ctx, session), 'info')
			return
		}
		await openModelPicker(ctx, pickerDeps(pi, session, ctx, pricing))
	}
	// `/models` is the unified surface; `/fallback` stays as the name this
	// extension has always answered to.
	const options = {
		description:
			'Models: session model, reasoning, scope, fallback chain, agent pins',
		getArgumentCompletions: argumentCompletions,
		handler,
	}
	pi.registerCommand('models', options)
	pi.registerCommand('fallback', options)
}
