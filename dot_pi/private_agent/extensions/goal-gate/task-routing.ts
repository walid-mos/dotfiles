/** Human prompts open work; declared deliverables are reviewed for delegation. */
import { isJevConfigured } from '../jev/client.ts'

import { declareItems } from './ledger-edits.ts'
import { ledgerStatus, requestItem } from './ledger.ts'
import { pruneRoutingLogs, recordRouting } from './routing-log.ts'
import {
	classifyTask,
	proposeScope,
	reviewScope,
	routeInstruction,
	scopeInstruction,
} from './routing.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { GoalGate } from './gate.ts'
import type { RoutingRecord } from './routing-log.ts'
import type { TaskClassification } from './routing.ts'

export type TaskLedgerIO = {
	read: (path: string) => string | undefined
	write: (path: string, text: string) => void
}

export type TaskRouter = {
	reviewDeclared: (
		deliverables: string[],
		surfaces: string[],
		ctx: ExtensionContext,
	) => Promise<string>
}

type RoutingState = {
	pendingPrompt: string | undefined
	currentRequest: string
	requestNumber: number
}

type RoutingDependencies = {
	gate: GoalGate
	ledger: TaskLedgerIO
	classify: (prompt: string) => Promise<TaskClassification>
}

const REQUEST_ID_RADIX = 36
const ROUTING_WARNING =
	'Jev task routing unavailable; treating the request as work. Check TYPESAFE_API_KEY and API connectivity.'
const SCOPE_WARNING =
	'Jev scope review unavailable; using the ledger proposal. Check TYPESAFE_API_KEY and API connectivity.'

async function classifyOrFallback(
	prompt: string,
	classify: RoutingDependencies['classify'],
): Promise<TaskClassification & { fallback?: RoutingRecord['fallback'] }> {
	if (classify === classifyTask && !isJevConfigured())
		return {
			route: 'work',
			isJevUnavailable: true,
			fallback: 'missing-key',
		}
	try {
		return await classify(prompt)
	} catch {
		return {
			route: 'work',
			isJevUnavailable: true,
			fallback: 'request-failed',
		}
	}
}

/** Only human-origin prompts are classified; settle continuations never open goals. */
export function watchTaskRouting(
	pi: ExtensionAPI,
	gate: GoalGate,
	ledger: TaskLedgerIO,
	options: {
		classify?: RoutingDependencies['classify']
		review?: typeof reviewScope
	} = {},
): TaskRouter {
	const state: RoutingState = {
		pendingPrompt: undefined,
		currentRequest: '',
		requestNumber: 0,
	}
	const dependencies: RoutingDependencies = {
		gate,
		ledger,
		classify: options.classify ?? classifyTask,
	}
	pi.on('session_start', () => {
		state.pendingPrompt = undefined
		state.currentRequest = ''
		state.requestNumber = 0
	})
	pi.on('input', input => {
		if (input.source === 'interactive' || input.source === 'rpc')
			state.pendingPrompt = input.text
	})
	pi.on('before_agent_start', async (_event, ctx) => {
		const prompt = state.pendingPrompt
		state.pendingPrompt = undefined
		if (!prompt) return
		return routeHumanPrompt(prompt, ctx, state, dependencies)
	})
	return {
		reviewDeclared: (deliverables, surfaces, ctx) =>
			reviewDeclared(
				{ request: state.currentRequest, deliverables, surfaces },
				ctx,
				options.review ?? reviewScope,
			),
	}
}

async function routeHumanPrompt(
	prompt: string,
	ctx: ExtensionContext | undefined,
	state: RoutingState,
	dependencies: RoutingDependencies,
): Promise<{
	message: { customType: string; content: string; display: boolean }
}> {
	// oxlint-disable-next-line eslint/no-param-reassign -- RoutingState owns this session's current request.
	state.currentRequest = prompt
	const path = dependencies.gate.ledgerFile
	const hasOpenGoal = Boolean(
		path && ledgerStatus(dependencies.ledger.read(path) ?? '').open.length,
	)
	const classification = await classifyOrFallback(
		prompt,
		dependencies.classify,
	)
	if (classification.isJevUnavailable) warn(ctx, ROUTING_WARNING)
	logDecision(ctx, {
		stage: 'request',
		prompt,
		result: classification.route,
		decision: classification.decision,
		fallback: classification.fallback,
	})
	if (!hasOpenGoal && path && classification.route === 'work') {
		// oxlint-disable-next-line eslint/no-param-reassign -- RoutingState owns this session's request counter.
		state.requestNumber += 1
		const request = requestItem(
			`${Date.now().toString(REQUEST_ID_RADIX)}-${state.requestNumber}`,
		)
		const declaration = declareItems(dependencies.ledger.read(path), [
			request,
		])
		dependencies.ledger.write(path, declaration.text)
		dependencies.gate.noteNewWork()
	}
	return {
		message: {
			customType: 'task-routing',
			content: routeInstruction(classification.route, {
				hasOpenGoal,
				isJevUnavailable: classification.isJevUnavailable,
			}),
			display: false,
		},
	}
}

async function reviewDeclared(
	input: { request: string; deliverables: string[]; surfaces: string[] },
	ctx: ExtensionContext,
	review: typeof reviewScope,
): Promise<string> {
	const proposedScope = proposeScope(input.deliverables)
	let scope = proposedScope
	let decision: RoutingRecord['decision']
	let fallback: RoutingRecord['fallback']
	if (!isJevConfigured() && review === reviewScope) {
		fallback = 'missing-key'
	} else {
		try {
			const reviewed = await review({ ...input, proposedScope })
			scope = reviewed.scope
			decision = reviewed.decision
		} catch {
			fallback = 'request-failed'
		}
	}
	if (fallback) warn(ctx, SCOPE_WARNING)
	logDecision(ctx, {
		stage: 'scope',
		prompt: input.request,
		result: scope,
		proposedScope,
		surfaceCount: input.surfaces.length,
		decision,
		fallback,
	})
	return `${fallback ? `Warning: ${SCOPE_WARNING} ` : ''}Ledger proposes ${proposedScope}; ${decision ? `Jev reviews ${scope}` : `fallback uses ${scope}`}. ${scopeInstruction(scope)}`
}

/** Evidence failure is visible, but cannot prevent a task from starting. */
function logDecision(
	ctx: ExtensionContext | undefined,
	record: Omit<RoutingRecord, 'sessionId'>,
): void {
	if (!ctx) return
	const sessionId = ctx.sessionManager.getSessionId()
	try {
		recordRouting({ ...record, sessionId })
		pruneRoutingLogs(sessionId)
	} catch {
		warn(ctx, 'Jev routing decision could not be saved.')
	}
}

/** TUI notices are not printed in one-shot/JSON/RPC modes; stderr is. */
function warn(ctx: ExtensionContext | undefined, message: string): void {
	if (!ctx) return
	if (ctx.mode === 'tui') {
		ctx.ui.notify(message, 'warning')
		return
	}
	process.stderr.write(`Warning: ${message}\n`)
}
