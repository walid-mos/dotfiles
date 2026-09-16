/**
 * model-fallback - keep the main session on a working model.
 *
 * When the provider behind the session model fails (the recurring `inco` 502s),
 * pi retries the same model and then surfaces the error. This extension watches
 * the provider response and the run outcome, then moves the main session to the
 * next usable model of a user-configured chain and asks the model to continue
 * the interrupted task. Subagents that inherit the session model follow that
 * switch, and per-agent pins are left to the existing `/subagents` admin.
 *
 * A failure on the first provider response of a run aborts the doomed attempt
 * immediately instead of waiting for pi's same-model retries. Context overflow
 * is never treated as a model failure: pi compacts for that.
 *
 * Module structure: `config.ts` (chain + toggles, persisted), `taxonomy.ts`
 * (status/error classification), `chain.ts` (candidate ordering + cooldowns),
 * `fallback-session.ts` (the per-session decision state), `failover.ts` (the
 * model moves, status line and continuation message), `picker.ts` (the unified
 * picker flow and status text), `model-catalog.ts` / `model-price.ts` /
 * `model-price-gauge.ts` / `openrouter-pricing.ts` /
 * `model-picker-state.ts` / `model-picker-view.ts` / `model-picker-list.ts` /
 * `model-picker-price.ts` / `model-picker-groups.ts` / `model-picker-window.ts` /
 * `model-picker-commands.ts` / `model-picker-editor.ts` /
 * `model-picker-render.ts` / `model-picker-component.ts` (the picker's rows,
 * pricing, state, layout, row actions and input), `model-picker-settings.ts`
 * (the settings snapshot it displays and the one agent pin it writes); this
 * file is only the pi event wiring. The decision logic is
 * unit-tested in `../tests/model-fallback.test.ts`, the picker in
 * `../tests/model-picker.test.ts` and `../tests/model-picker-handoff.test.ts`,
 * the live OpenRouter price list in `../tests/openrouter-pricing.test.ts`.
 */

import { modelReference } from './chain.ts'
import { registerFallbackCommand } from './command.ts'
import { configPath, defaultConfig, loadConfig } from './config.ts'
import {
	currentModelReference,
	endFallback,
	performFailover,
	registerFallbackRenderer,
	restoreOriginal,
} from './failover.ts'
import { FallbackSession } from './fallback-session.ts'

import type {
	AgentEndEvent,
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { ModelFallbackConfig } from './config.ts'

type RunMessage = AgentEndEvent['messages'][number]
type AssistantMessage = Extract<RunMessage, { role: 'assistant' }>

export default function modelFallback(pi: ExtensionAPI): void {
	const session = new FallbackSession(defaultConfig())
	watchSession(pi, session)
	watchProviderCalls(pi, session)
	watchRunOutcome(pi, session)
	watchModelSelection(pi, session)
	watchCompaction(pi, session)
	registerFallbackRenderer(pi)
	registerFallbackCommand(pi, session)
}

/** The last assistant message of the run, if the run produced one. */
function lastAssistantMessage(
	messages: readonly RunMessage[],
): AssistantMessage | undefined {
	for (const message of messages.toReversed()) {
		if (message.role === 'assistant') return message
	}
	return undefined
}

/** The persisted config, or the built-in defaults when the file is unusable. */
function loadConfiguredSession(ctx: ExtensionContext): ModelFallbackConfig {
	try {
		return loadConfig(configPath())
	} catch (error) {
		ctx.ui.notify(
			`model-fallback: ${String(error)}; using defaults.`,
			'error',
		)
		return defaultConfig()
	}
}

/** A session start (or a reload) reloads the config and starts from nothing. */
function watchSession(pi: ExtensionAPI, session: FallbackSession): void {
	pi.on('session_start', (_event, ctx) => {
		session.startSession(loadConfiguredSession(ctx))
		endFallback(ctx, session)
	})
	pi.on('session_shutdown', (_event, ctx) => {
		endFallback(ctx, session)
	})
}

/**
 * The first provider response of a run is the only one worth aborting: a 5xx
 * there means every retry of this attempt fails the same way, so the doomed
 * attempt is cut short instead of burning pi's retries.
 */
function watchProviderCalls(pi: ExtensionAPI, session: FallbackSession): void {
	pi.on('agent_start', () => {
		session.startRun()
	})
	pi.on('after_provider_response', (event, ctx) => {
		session.beginCall()
		const mustAbort = session.noteResponse(
			event.status,
			currentModelReference(ctx),
			ctx.isIdle(),
		)
		if (mustAbort) ctx.abort()
	})
}

/**
 * The run's own verdict: a retryable provider error is the failure a settled
 * agent fails over from, an overflow belongs to pi's compaction, and anything
 * else - including a user abort - leaves the session where it is.
 */
function watchRunOutcome(pi: ExtensionAPI, session: FallbackSession): void {
	pi.on('agent_end', (event, ctx) => {
		const assistant = lastAssistantMessage(event.messages)
		if (!assistant) return
		session.noteRunEnd(
			{
				stopReason: assistant.stopReason,
				errorText: assistant.errorMessage,
			},
			currentModelReference(ctx),
			Date.now(),
		)
	})
	pi.on('agent_settled', async (_event, ctx) => {
		const decision = session.settle()
		if (decision.failure) {
			await performFailover(pi, ctx, session, decision.failure)
			return
		}
		if (decision.shouldRestore) await restoreOriginal(pi, ctx, session)
	})
}

/**
 * A switch this extension issued itself is not a user takeover, so it is
 * consumed here; any other one means a human moved the session, and the
 * fallback around it ends.
 */
function watchModelSelection(pi: ExtensionAPI, session: FallbackSession): void {
	pi.on('model_select', (event, ctx) => {
		if (session.consumeSwitch(modelReference(event.model))) return
		endFallback(ctx, session)
	})
}

/**
 * Compaction drives its own provider calls, and the responses read while it
 * runs say nothing about the provider's ability to serve the session.
 */
function watchCompaction(pi: ExtensionAPI, session: FallbackSession): void {
	pi.on('session_before_compact', () => {
		session.enterCompaction()
	})
	pi.on('session_compact', () => {
		session.leaveCompaction()
	})
	pi.on('session_compact_failed', () => {
		session.leaveCompaction()
	})
}
