/**
 * model-fallback - the model moves this extension performs, plus the status
 * line and the continuation message that go with them.
 *
 * `performFailover` moves a session whose model just failed onto the next
 * usable model of the chain and asks the model to pick the interrupted task
 * back up; `restoreOriginal` returns a session that ran cleanly to the model
 * it started on. Both are the only callers of `pi.setModel`, and both own
 * their user-facing notification, so the decision stays in `FallbackSession`.
 */

import { Text } from '@earendil-works/pi-tui'

import { modelReference, parseModelReference } from './chain.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { FallbackSession, FailureSighting } from './fallback-session.ts'

const CUSTOM_TYPE = 'model-fallback'
const STATUS_KEY = 'model-fallback'

/** The details the continuation message carries for its renderer. */
interface FallbackMessageDetails {
	failedModel?: string | undefined
	candidate?: string | undefined
	reason?: string | undefined
}

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

/**
 * Asks the model to continue where the failed attempt stopped, unless pi
 * already holds queued messages - those continue on their own.
 */
function continueAfterFailover(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	failure: FailureSighting,
	candidate: string,
): void {
	if (ctx.hasPendingMessages()) return
	pi.sendMessage(
		{
			customType: CUSTOM_TYPE,
			content: `The previous model attempt failed (${failure.reason}). The session switched to ${candidate}. Continue the interrupted task exactly where it stopped; do not apologize or repeat completed work.`,
			display: true,
			details: {
				failedModel: failure.model,
				candidate,
				reason: failure.reason,
			} satisfies FallbackMessageDetails,
		},
		{ triggerTurn: true },
	)
}

/** Move the session onto the next usable chain model and restart the turn. */
export async function performFailover(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	session: FallbackSession,
	failure: FailureSighting,
): Promise<void> {
	const now = Date.now()
	session.coolDown(failure.model, now)
	const target = resolveTarget(
		ctx,
		session.candidatesAfter(failure.model, now),
	)
	if (!target) {
		const chain = session.currentConfig().chain.join(' → ') || 'empty'
		ctx.ui.notify(
			`Model fallback exhausted after ${failure.model ?? 'the current model'} failed (${failure.reason}); chain: ${chain}.`,
			'warning',
		)
		return
	}
	session.trackSwitch(target.reference)
	if (!(await pi.setModel(target.model))) {
		session.forgetSwitch(target.reference)
		ctx.ui.notify(
			`model-fallback: no credentials configured for ${target.reference}.`,
			'error',
		)
		return
	}
	session.markFallbackActive(failure.model)
	reportFallback(ctx, failure, target.reference)
	continueAfterFailover(pi, ctx, failure, target.reference)
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

/**
 * How the continuation message reads in the transcript: one dim line, with the
 * rest of the story only when the user expands it.
 */
export function registerFallbackRenderer(pi: ExtensionAPI): void {
	pi.registerMessageRenderer<FallbackMessageDetails>(
		CUSTOM_TYPE,
		(message, { expanded, outputPad }, theme) => {
			const { failedModel, candidate, reason } = message.details ?? {}
			const summary = `↯ ${failedModel ?? 'the previous model'} failed (${reason ?? 'provider error'}) → fallback ${candidate ?? 'the next model'}`
			const detail = expanded
				? `\n  the turn restarted on ${candidate ?? 'the next model'}; completed work is kept`
				: ''
			return new Text(theme.fg('dim', summary + detail), outputPad, 0)
		},
	)
}
