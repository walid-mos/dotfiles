/**
 * fallback - the model moves this extension performs, plus the status
 * line and the continuation message that go with them.
 *
 * `performFailover` moves a session whose model just failed onto the next
 * usable model of the chain and asks the model to pick the interrupted task
 * back up; `restoreOriginal` returns the session to the model it started on,
 * either when a run settles cleanly on the fallback model or when a turn
 * boundary inside a long fallback run could use it again. Both are the only
 * callers of `pi.setModel`, and both own
 * their user-facing notification, so the decision stays in `FallbackSession`.
 */

import { activeGoal, goalText } from '#lib/goal/state.ts'
import { FALLBACK_STATUS_KEY as STATUS_KEY } from '#lib/model-fallback/status.ts'

import { modelReference, parseModelReference } from './chain.ts'
import { FALLBACK_MESSAGE_TYPE } from './fallback-message.ts'

import type {
	BoundaryResult,
	CustomMessageEntryDraft,
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { FallbackMessageDetails } from './fallback-message.ts'
import type { FallbackSession, FailureSighting } from './fallback-session.ts'

type RegistryModel = NonNullable<
	ReturnType<ExtensionContext['modelRegistry']['find']>
>

interface FailoverTarget {
	reference: string
	model: RegistryModel
}

/** The session's model as a chain reference (`provider/modelId`). */
export function currentModelReference(
	ctx: ExtensionContext,
): string | undefined {
	if (!ctx.model) return undefined
	return modelReference(ctx.model)
}

/** Ends the fallback: the session keeps its model and loses the status line. */
export function endFallback(
	ctx: ExtensionContext,
	session: FallbackSession,
): void {
	session.clearFallback()
	ctx.ui.setStatus(STATUS_KEY, undefined)
}

function findModel(
	ctx: ExtensionContext,
	reference: string,
): RegistryModel | undefined {
	const parsed = parseModelReference(reference)
	if (!parsed) return undefined
	return ctx.modelRegistry.find(parsed.provider, parsed.modelId)
}

/** The first candidate this machine can actually run right now. */
function resolveTarget(
	ctx: ExtensionContext,
	candidates: readonly string[],
): FailoverTarget | undefined {
	for (const reference of candidates) {
		const model = findModel(ctx, reference)
		if (!model || !ctx.modelRegistry.hasConfiguredAuth(model)) continue
		return { reference, model }
	}
	return undefined
}

/** Announces a switch the user has to know about: it changed their provider. */
function reportFallback(
	ctx: ExtensionContext,
	failure: FailureSighting,
	reference: string,
): void {
	ctx.ui.notify(
		`Fallback: ${failure.model ?? 'current model'} → ${reference} (${failure.reason})`,
		'warning',
	)
	ctx.ui.setStatus(STATUS_KEY, `↯ ${reference} (fallback)`)
}

/** Continue the same request with the current checklist, without creating human input. */
function continuationAfterFailover(
	ctx: ExtensionContext,
	failure: FailureSighting,
	candidate: string,
): CustomMessageEntryDraft {
	const goal = activeGoal(ctx.sessionManager.getBranch())
	return {
		type: 'custom_message',
		customType: FALLBACK_MESSAGE_TYPE,
		content: [
			`The previous model attempt failed (${failure.reason}). The session switched to ${candidate}. Follow the latest human request and resume it from its last verified result. A provider failure is not task completion. Retain the checklist and its existing IDs; only verified results complete items. This recovery message is not a new human request.`,
			goal ? goalText(goal) : '',
		]
			.filter(Boolean)
			.join('\n'),
		display: true,
		details: {
			failedModel: failure.model,
			candidate,
			reason: failure.reason,
		} satisfies FallbackMessageDetails,
	}
}

/** Switch at agent_before_settle and return one same-request continuation. */
export async function performFailover(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	session: FallbackSession,
	failure: FailureSighting,
): Promise<BoundaryResult | undefined> {
	if (ctx.signal?.aborted) return undefined
	const sessionId = ctx.sessionManager.getSessionId()
	const now = Date.now()
	session.coolDown(failure.model, now)
	const target = resolveTarget(
		ctx,
		session.candidatesAfter(failure.model, now),
	)
	if (!target) {
		const chain = session.currentConfig().chain.join(' → ') || 'empty'
		ctx.ui.notify(
			`Model fallback exhausted after ${failure.model ?? 'the current model'} failed (${failure.reason}); chain: ${chain}. The interrupted request remains unfinished; resume it when a provider is available.`,
			'warning',
		)
		return
	}
	session.trackSwitch(target.reference)
	if (!(await pi.setModel(target.model))) {
		session.forgetSwitch(target.reference)
		ctx.ui.notify(
			`fallback: no credentials configured for ${target.reference}.`,
			'error',
		)
		return
	}
	if (ctx.signal?.aborted || sessionId !== ctx.sessionManager.getSessionId())
		return undefined
	session.markFallbackActive(failure.model)
	reportFallback(ctx, failure, target.reference)
	return {
		entries: ctx.hasPendingMessages()
			? []
			: [continuationAfterFailover(ctx, failure, target.reference)],
		continue: true,
	}
}

/** Return a session that ran cleanly to the model it started on. */
export async function restoreOriginal(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	session: FallbackSession,
): Promise<void> {
	const reference = session.restoreModel()
	if (!reference || reference === currentModelReference(ctx)) {
		endFallback(ctx, session)
		return
	}
	// Restoring a model that is still cooling down would flap straight back
	// into the failure that put this session on a fallback.
	if (session.isCoolingDown(reference, Date.now())) return
	const model = findModel(ctx, reference)
	if (!model) {
		endFallback(ctx, session)
		return
	}
	session.trackSwitch(reference)
	if (!(await pi.setModel(model))) {
		session.forgetSwitch(reference)
		return
	}
	ctx.ui.notify(`Restored main model ${reference}.`, 'info')
	endFallback(ctx, session)
}
