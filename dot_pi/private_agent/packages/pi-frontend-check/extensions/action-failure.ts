import { boundedText } from './report.ts'

import type { ActOptions, BatchStep } from './action-schema.ts'

/** The batch part of a step failure: what ran, what remains. */
export type BatchFailure = {
	/** The id of the failed (or readiness-failed) step. */
	step: string
	/** Zero-based position of the failed step. */
	index: number
	total: number
	/** Ids of the steps that ran to completion before the failure. */
	completed: string[]
	/** The failed step plus every unexecuted later step: the retry set. */
	remaining: string[]
}

/** What a failed frontend_act or frontend_batch step can prove about itself. */
export type ActionFinding = {
	action: string
	target?: string | undefined
	wait_for?: string | undefined
	/** The core action already ran and only the post-action readiness check failed. */
	actionRan: boolean
	/** The failing phase's own Playwright or usage message. */
	reason: string
	/** The locator checked right after the failure. */
	failingLocator?: string | undefined
	failingLocatorMatches?: number | undefined
	currentUrl?: string | undefined
	batch?: BatchFailure | undefined
}

/** The two phases of one step: the requested action, then its readiness check. */
export type ActFailurePhase = 'action' | 'readiness'

/** Page facts captured right after a failure, for the failed report. */
export type StepFailureDiagnosis = { url: string; matches?: number | undefined }

/**
 * An ordinary frontend_act/frontend_batch step failure. Its message is the
 * bounded, redacted failed report, so the tool error that surfaces it carries
 * the failed step and locator diagnostics.
 */
export class ActionFailure extends Error {
	readonly finding: ActionFinding

	constructor(
		message: string,
		finding: ActionFinding,
		options?: ErrorOptions,
	) {
		super(message, options)
		this.finding = finding
	}
}

/** The locator checked right after a failure: the readiness target, else the action target. */
export function failingStepLocator(
	options: ActOptions,
	phase: ActFailurePhase,
): string | undefined {
	return phase === 'readiness' ? options.wait_for : options.target
}

/** The failed step and every unexecuted later step: the retry set. */
export function batchStepFailure(
	steps: readonly BatchStep[],
	index: number,
	completedIds: readonly string[],
): BatchFailure {
	const remaining = steps.slice(index).map(step => step.id)
	const [step] = remaining
	if (!step) throw new Error('No batch step at this failure index.')
	return {
		step,
		index,
		total: steps.length,
		completed: [...completedIds],
		remaining,
	}
}

/** One line naming the requested step, as the caller spelled it. */
export function describeActStep(options: {
	action: string
	target?: string | undefined
}): string {
	return options.target
		? `${options.action} on "${options.target}"`
		: options.action
}

function findingTitle(finding: ActionFinding): string {
	const stage = finding.actionRan
		? `action ${describeActStep(finding)} completed, but wait_for "${finding.wait_for}" did not become visible`
		: describeActStep(finding)
	return finding.batch
		? `Frontend batch failed at step ${finding.batch.index + 1}/${finding.batch.total} "${finding.batch.step}": ${stage}.`
		: `Frontend action failed: ${stage}.`
}

function findingRecovery(finding: ActionFinding): string {
	const firstStep = finding.actionRan
		? 'The failed step already ran its action, so re-running the remainder may repeat it; inspect the current page (frontend_eval) first.'
		: 'Fix the locator or inspect the current page (frontend_eval, frontend_console) first. A failed action does not prove it had no effect: a click can navigate or open the popup it targeted even while its wait times out, so inspect the page before re-running.'
	const retry = finding.batch
		? `Then re-run only the failed remainder from "${finding.batch.step}": ${finding.batch.remaining.join(', ')}.`
		: 'Re-run just this action once corrected.'
	return `The browser, login and page state are preserved. ${firstStep} ${retry}`
}

export function formatActionFinding(finding: ActionFinding): string {
	const lines = [findingTitle(finding), `Reason: ${finding.reason}`]
	if (finding.failingLocator)
		lines.push(
			typeof finding.failingLocatorMatches === 'number'
				? `Locator "${finding.failingLocator}" now matches ${finding.failingLocatorMatches} element(s) on the current page.`
				: `Locator "${finding.failingLocator}": match count unavailable.`,
		)
	if (finding.currentUrl) lines.push(`URL: ${finding.currentUrl}`)
	if (finding.batch?.completed.length)
		lines.push(
			`Already applied, not replayed automatically: ${finding.batch.completed.join(', ')}.`,
		)
	lines.push('', findingRecovery(finding))
	return lines.join('\n')
}

/**
 * Per-field bounds: one huge field (a Playwright failure message echoes long
 * selectors) could otherwise push the locator count, completed ids and retry
 * guidance out of the overall report cap. Batch ids arrive schema-bounded
 * (100 chars); selectors and failure reasons are not.
 */
const MAX_REASON_BYTES = 2000
const MAX_SELECTOR_BYTES = 400
const MAX_URL_BYTES = 1000

/**
 * The session failure for one ordinary step failure: secret-redacted, bounded
 * report as the message, structured finding preserved for callers.
 */
export function buildActFailure(state: {
	options: ActOptions
	phase: ActFailurePhase
	error: unknown
	diagnosis: StepFailureDiagnosis
	batch?: BatchFailure | undefined
	redact: (text: string) => string
}): ActionFailure {
	const { options, phase, error, diagnosis, batch, redact } = state
	// Redact before bounding: a clip inside a half-secret could expose its
	// visible part; redaction destroys the whole secret first.
	// Escape field newlines so they cannot consume the report's line budget.
	const inline = (text: string): string =>
		redact(text).replaceAll('\r', '\\r').replaceAll('\n', '\\n')
	const clip = (
		text: string | undefined,
		maxBytes: number,
	): string | undefined => (text ? boundedText(inline(text), maxBytes) : text)
	const reason = error instanceof Error ? error.message : String(error)
	const finding: ActionFinding = {
		action: options.action,
		target: clip(options.target, MAX_SELECTOR_BYTES),
		wait_for: clip(options.wait_for, MAX_SELECTOR_BYTES),
		actionRan: phase === 'readiness',
		// Reason is a required finding field; an empty message stays empty.
		reason: reason ? boundedText(inline(reason), MAX_REASON_BYTES) : reason,
		failingLocator: clip(
			failingStepLocator(options, phase),
			MAX_SELECTOR_BYTES,
		),
		failingLocatorMatches: diagnosis.matches,
		currentUrl: clip(diagnosis.url, MAX_URL_BYTES),
	}
	if (batch)
		finding.batch = {
			...batch,
			step: inline(batch.step),
			completed: batch.completed.map(inline),
			remaining: batch.remaining.map(inline),
		}
	// Every field is bounded above, so this final cap is only a guarantee that
	// the report - failed step, matched count, completed ids, retry guidance -
	// never exceeds the overall text budget during composition.
	return new ActionFailure(
		boundedText(formatActionFinding(finding)),
		finding,
		{
			cause: error,
		},
	)
}
