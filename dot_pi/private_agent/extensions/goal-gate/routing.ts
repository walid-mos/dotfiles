/** Two decisions: the prompt says whether there is work; declared work says how broad it is. */
import { askChoice } from '../jev/client.ts'

import type { ChoiceQuestion, ChoiceResult } from '../jev/client.ts'

export type TaskRoute = 'answer' | 'work'
export type ScopeRoute = 'direct' | 'scoped'
export type TaskClassification = {
	route: TaskRoute
	decision?: ChoiceResult
	isJevUnavailable?: boolean
}

/** Uncertain work is tracked; uncertain scope receives the stronger instruction. */
const MIN_CONFIDENCE = 0.45
const ROUTING_TIMEOUT_MS = 4_000

export const ROUTING_QUESTION: ChoiceQuestion = {
	instructions:
		"Classify the CURRENT request, in any language, as an answer-only exchange or work for the agent. 'How would you refactor X?' asks for an approach, not to do the refactor. 'Could we make X match the prototype?' asks if it is feasible. 'What would you test?' asks for an explanation. 'Can you make X match the prototype?' asks the agent to do it. A question may still command work: 'Why does it fail? Investigate and fix it' is work. Imperatives to inspect, audit, compare, research, plan a deliverable, change code, run a command, or create something are work. Judge the entire request, not punctuation, length or language. Do not estimate complexity here.",
	criteria: {
		answer: 'Only answer, explain, discuss, brainstorm, or clarify; no action or deliverable requested.',
		work: 'Perform an action or deliver a result, including lookups, audits, code changes, and end-to-end work.',
	},
}

export const SCOPE_QUESTION: ChoiceQuestion = {
	instructions:
		'Review the request, discovered affected surfaces, and actual deliverables declared by the agent. The ledger proposes a scope from the number of deliverables; this is only a heuristic, not the answer. Decide whether the work contains one bounded workstream or several independent substantial workstreams. Discovery followed by verification across multiple affected surfaces, broad refactors, exhaustive audits and multiple fixes are scoped. A small change or one lookup can be direct even when its checklist has several steps. Prefer scoped when substantial independent work might benefit from parallel reading or isolated work. Use the request and the concrete deliverables, not wording alone.',
	criteria: {
		direct: 'One bounded workstream or small change, lookup, or verification; no independent substantial work to delegate.',
		scoped: 'Several independent substantial workstreams, a broad refactor/audit, or discovery and end-to-end verification across affected surfaces.',
	},
}

export function decideRoute(
	decision: Pick<ChoiceResult, 'choice' | 'confidence'>,
): TaskRoute {
	return decision.choice === 'answer' &&
		Number.isFinite(decision.confidence) &&
		decision.confidence >= MIN_CONFIDENCE
		? 'answer'
		: 'work'
}

export function decideScope(
	decision: Pick<ChoiceResult, 'choice' | 'confidence'>,
): ScopeRoute {
	return decision.choice === 'direct' &&
		Number.isFinite(decision.confidence) &&
		decision.confidence >= MIN_CONFIDENCE
		? 'direct'
		: 'scoped'
}

/** A deterministic proposal, reviewed rather than blindly accepted by Jev. */
export function proposeScope(deliverables: string[]): ScopeRoute {
	return deliverables.length > 1 ? 'scoped' : 'direct'
}

export async function classifyTask(
	prompt: string,
): Promise<TaskClassification> {
	const decision = await askChoice({ request: prompt }, ROUTING_QUESTION, {
		timeoutMs: ROUTING_TIMEOUT_MS,
	})
	return { route: decideRoute(decision), decision }
}

export async function reviewScope(input: {
	request: string
	deliverables: string[]
	surfaces: string[]
	proposedScope: ScopeRoute
}): Promise<{ scope: ScopeRoute; decision: ChoiceResult }> {
	const decision = await askChoice(input, SCOPE_QUESTION, {
		timeoutMs: ROUTING_TIMEOUT_MS,
	})
	return { scope: decideScope(decision), decision }
}

/** One per-turn instruction; the reviewer only runs after deliverables exist. */
export function routeInstruction(
	route: TaskRoute,
	options: { hasOpenGoal: boolean; isJevUnavailable?: boolean | undefined },
): string {
	if (route === 'answer')
		return 'This turn is a question: answer it without creating a new goal or launching subagents. If a prior goal is open, keep it intact.'
	const warning = options.isJevUnavailable
		? 'Warning: Jev task routing was unavailable. This request is treated as work; the goal remains tracked. '
		: ''
	const start = options.hasOpenGoal
		? 'The goal ledger is already open. Update its items when this request changes scope; never create a parallel subagent checklist.'
		: 'The goal ledger has a request-level item. Before acting, declare concrete deliverables with `goal`; close the request-level item only after auditing the whole request. If this is only a question with no deliverable, use `goal dismiss` with a reason before declaring any work.'
	return `${warning}${start} Inspect the relevant code, ticket, or prototype; enumerate every requested behavior and affected surface, including variants and edge cases. Declare checkable deliverables and pass discovered files/screens/systems in the surfaces field of goal declare so Jev can review them. The ledger proposes scope from those deliverables and Jev reviews it; a warning means the ledger proposal was used instead. Revise the SAME ledger when discovery reveals missing work. Tick only with actual evidence; before the final tick, compare every requested outcome against the result and fix omissions.`
}

export function scopeInstruction(scope: ScopeRoute): string {
	return scope === 'scoped'
		? 'After inspection, use subagents for independent, substantial reading or isolated work if they shorten the critical path; use one top-level workflow and one writer per worktree. Have children report evidence for the parent to tick in the SAME goal ledger; never track a second checklist. Do not delegate tightly coupled or trivial work.'
		: 'Handle bounded work directly. If inspection reveals independent substantial workstreams, revise the ledger and request another scope review; their findings feed the SAME goal ledger, never a second checklist.'
}
