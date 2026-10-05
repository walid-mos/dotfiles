// What a checkpoint state carries beyond the page itself, and how the driver reads
// it: the action that produced the state plus the scenario `probe` on both sides of
// that action. Kept apart from the browser orchestration in scenario.ts so both files
// stay small enough to read.
import type { Page } from 'playwright-core'
import type { ScenarioStep } from './schema.ts'

const JSON_INDENT = 2

/** What the driver had just done when a state was recorded. */
export interface Attempt {
	step: string
	action: string
	target?: string
}

/** A probe value on both sides of an action: equal values mean the page did not move. */
export interface Observation {
	before: unknown
	after: unknown
}

/** One scenario run as it progresses. */
export interface StepOutcome {
	completedSteps: number
	stateFiles: string[]
	failure?: string
	lastAction?: Attempt
	lastObservation?: Observation
}

export interface StepAnnotations {
	action?: Attempt
	observation?: Observation
}

export function attemptOf(step: ScenarioStep): Attempt {
	const attempt: Attempt = { step: step.id, action: step.act.action }
	if (step.act.target) attempt.target = step.act.target
	return attempt
}

/** Probes exist for actions: a step that only waits neither reads nor overwrites them. */
export function actionable(step: ScenarioStep): boolean {
	return step.act.action !== 'wait_for'
}

export async function captureState(
	page: Page,
	expression: string,
	maxChars: number,
): Promise<string> {
	const evaluated: unknown = await page.evaluate(expression)
	const serialized =
		JSON.stringify(evaluated, null, JSON_INDENT) ?? String(evaluated)
	const bytes = Buffer.byteLength(serialized, 'utf8')
	if (bytes > maxChars)
		throw new Error(
			`Checkpoint state is ${bytes} bytes, over MAX_EVAL_CHARS (${maxChars}); narrow the extract expression.`,
		)
	return serialized
}

/**
 * A state needs the action that produced it, not only the resulting page: step 1
 * before and after a refused Continue renders identically, so a bare snapshot cannot
 * say whether progression was blocked. `after` names the action, `observed` carries
 * the probe on both sides of it - facts, never a verdict.
 */
export function annotateState(
	state: string,
	attempt: Attempt | undefined,
	observation: Observation | undefined,
): string {
	if (!attempt) return state
	const annotations: Record<string, unknown> = { after: attempt }
	if (observation) annotations.observed = observation
	const parsed: unknown = JSON.parse(state)
	const snapshot =
		typeof parsed === 'object' && parsed !== null
			? { ...annotations, ...parsed }
			: { ...annotations, page: parsed }
	return JSON.stringify(snapshot, null, JSON_INDENT)
}

/** The scenario's `probe` at the point of call: the raw value. */
export async function probeStep(
	page: Page,
	probe: string | undefined,
	step: ScenarioStep,
): Promise<unknown> {
	if (!probe || !actionable(step)) return undefined
	return page.evaluate(probe)
}

/** Facts about the action just taken: what it was, and the probe values around it. */
export async function annotateAction(
	page: Page,
	probe: string | undefined,
	step: ScenarioStep,
	before: unknown,
): Promise<StepAnnotations> {
	if (!actionable(step)) return {}
	const action = attemptOf(step)
	if (!probe) return { action }
	return {
		action,
		observation: { before, after: await page.evaluate(probe) },
	}
}

/** Merge without assigning `undefined` to an optional field. */
export function mergeAnnotations(
	outcome: StepOutcome,
	annotations: StepAnnotations,
): StepOutcome {
	const merged: StepOutcome = { ...outcome }
	if (annotations.action) merged.lastAction = annotations.action
	if (annotations.observation)
		merged.lastObservation = annotations.observation
	return merged
}
