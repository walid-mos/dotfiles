/**
 * fallback - keep the main session on a working model.
 *
 * When the provider behind the session model fails (the recurring `inco` 502s),
 * pi surfaces the error at the end of the run. This extension watches the
 * provider response and the run outcome, then recovers in place: a transient
 * failure gets a small bounded same-model retry at the settle boundary while
 * pi keeps its own agent-level retry off, and only a failure that survives it
 * moves the main session to the next usable model of a user-configured chain
 * with a message asking to continue the interrupted task. A long fallback run
 * recovers the model it started from at the first clean turn boundary, so
 * preferred-model recovery does not wait for the whole run to end. Subagents
 * that inherit the session model follow that switch, and per-agent pins are
 * left to the existing `/subagents` admin.
 *
 * Context overflow is never treated as a model failure: pi compacts for that.
 *
 * Module structure: `config.ts` (chain + toggles, persisted), `taxonomy.ts`
 * (status/error classification), `retry-budget.ts` (retry credits),
 * `retry.ts` (the bounded wait and failed-attempt omission), `chain.ts` (candidate
 * ordering + cooldowns), `fallback-session.ts` (the per-session decision
 * state), `failover.ts` (the model moves, status line and continuation
 * message), `fallback-message.ts` (the transcript renderer), `command.ts`
 * (the `/models` command, status text and persisted config),
 * `command-filter.ts` (keeps the model commands `/models` replaces, and the
 * inert `llama` row, out of the slash menu), `picker.ts`
 * (the unified picker flow), `model-catalog.ts` / `model-price.ts` /
 * `model-price-gauge.ts` / `openrouter-pricing.ts` /
 * `model-picker-state.ts` / `model-picker-view.ts` / `model-picker-line.ts` /
 * `model-picker-list.ts` / `model-picker-price.ts` / `model-picker-groups.ts` /
 * `model-picker-window.ts` / `model-picker-effort.ts` /
 * `model-picker-keymap.ts` / `model-picker-commands.ts` /
 * `model-picker-scope-edits.ts` / `model-picker-editor.ts` /
 * `model-picker-editor-rows.ts` / `model-picker-editor-render.ts` /
 * `model-picker-render.ts` / `model-picker-scope.ts` /
 * `model-picker-tabs.ts` /
 * `model-picker-component.ts` (the picker's rows, pricing, state, shared
 * reasoning column, key routing, layout, row actions and input), `model-picker-settings.ts` /
 * `model-picker-settings-file.ts` (the settings snapshot it displays, the agent
 * pin and the `enabledModels` membership/order it writes, through the file's
 * own atomic read-modify-write) and `model-picker-saves.ts` (what those writes
 * tell the user); this file is only the pi event wiring. The decision logic is
 * unit-tested in `../tests/fallback.test.ts`, the picker in
 * `../tests/model-picker.test.ts` and `../tests/model-picker-handoff.test.ts`,
 * the live OpenRouter price list in `../tests/openrouter-pricing.test.ts`.
 */

import { modelReference } from './chain.ts'
import { createModelCommandFilter } from './command-filter.ts'
import { registerFallbackCommand } from './command.ts'
import { configPath, defaultConfig, loadConfig } from './config.ts'
import {
	currentModelReference,
	endFallback,
	performFailover,
	restoreOriginal,
} from './failover.ts'
import { registerFallbackRenderer } from './fallback-message.ts'
import { FallbackSession } from './fallback-session.ts'
import { failedAttemptOmission, waitForRetryDelay } from './retry.ts'

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
	watchProviderResponses(pi, session)
	watchRunOutcome(pi, session)
	watchBoundaries(pi, session)
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
		ctx.ui.notify(`fallback: ${String(error)}; using defaults.`, 'error')
		return defaultConfig()
	}
}

/** A session start (or a reload) reloads the config and starts from nothing. */
function watchSession(pi: ExtensionAPI, session: FallbackSession): void {
	pi.on('session_start', (_event, ctx) => {
		session.startSession(loadConfiguredSession(ctx))
		endFallback(ctx, session)
		// Pi cannot unregister a built-in command, so the menu is filtered
		// instead: the unified surface is the one the user sees.
		ctx.ui.addAutocompleteProvider(createModelCommandFilter)
	})
	pi.on('session_shutdown', (_event, ctx) => {
		endFallback(ctx, session)
	})
}

/**
 * A transient provider response is recorded as evidence only. The bounded
 * retry and the chain cascade read it at the settle boundary, next to the
 * run verdict; nothing is aborted while the run is still working.
 */
function watchProviderResponses(
	pi: ExtensionAPI,
	session: FallbackSession,
): void {
	pi.on('after_provider_response', (event, ctx) => {
		if (!ctx.hasUI) return
		session.noteResponse(event.status, currentModelReference(ctx))
	})
}

/**
 * The run's own verdict: a retryable provider error is the failure a settled
 * agent recovers from, an overflow belongs to pi's compaction, and a user
 * abort leaves the session where it is. Settlement only restores clean runs.
 */
function watchRunOutcome(pi: ExtensionAPI, session: FallbackSession): void {
	pi.on('agent_end', (event, ctx) => {
		if (!ctx.hasUI) return
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
		// Headless children own their model contract and fallback policy.
		if (!ctx.hasUI) return
		const decision = session.settle()
		if (decision.shouldRestore) await restoreOriginal(pi, ctx, session)
	})
}

/**
 * The two recovery boundaries pi offers inside and around a run.
 *
 * `agent_before_settle` is the retry budget's slot: the failed assistant
 * attempt is omitted from the model context, the caller waits the configured
 * delay, and one more request goes to the same model. Once those credits
 * run out, the same boundary switches models and continues the request.
 * `turn_end` handles preferred-model recovery: a long fallback run hands back to the
 * original model as soon as a turn ended cleanly and its cooldown expired,
 * instead of only at the settle of the whole run.
 */
function watchBoundaries(pi: ExtensionAPI, session: FallbackSession): void {
	pi.on('agent_before_settle', async (event, ctx) => {
		if (!ctx.hasUI || event.outcome !== 'error' || ctx.signal?.aborted)
			return
		const omission = failedAttemptOmission(event.context)
		if (!omission) return
		const retry = session.claimTransientRetry(event.outcome)
		if (!retry) {
			const { failure } = session.settle()
			if (!failure) return
			const recovery = await performFailover(pi, ctx, session, failure)
			if (!recovery) return
			return {
				...recovery,
				entries: [omission, ...(recovery.entries ?? [])],
			}
		}
		ctx.ui.notify(
			`Retrying ${retry.model ?? 'current model'} (attempt ${retry.attempt}/${retry.limit}) after ${retry.reason}.`,
			'info',
		)
		const sessionId = ctx.sessionManager.getSessionId()
		if (!(await waitForRetryDelay(retry.delayMs, ctx.signal))) return
		if (sessionId !== ctx.sessionManager.getSessionId()) return
		return { entries: [omission], continue: true }
	})
	pi.on('turn_end', async (event, ctx) => {
		if (!ctx.hasUI) return
		if (session.shouldRecoverAtBoundary(event.outcome, Date.now())) {
			await restoreOriginal(pi, ctx, session)
		}
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
