/** Live, repeatable Jev checks: prompt intent and post-discovery scope. */
import { askChoice, estimateUsd } from '#lib/jev/client.ts'
import {
	decideRoute,
	decideScope,
	ROUTING_QUESTION,
	SCOPE_QUESTION,
} from '../disabled-extensions/goal-gate/routing.ts'
import { routingCases, scopeCases } from '../tests/task-routing-cases.ts'

const requestResults = await Promise.all(
	routingCases.map(async sample => {
		const answer = await askChoice({ request: sample.prompt }, ROUTING_QUESTION)
		return {
			label: sample.prompt,
			expected: sample.expected === 'answer' ? 'answer' : 'work',
			actual: decideRoute(answer),
			answer,
		}
	}),
)
const scopeResults = await Promise.all(
	scopeCases.map(async sample => {
		const answer = await askChoice(
			{
				request: sample.request,
				deliverables: sample.deliverables,
				surfaces: sample.surfaces,
				proposedScope: sample.proposedScope,
			},
			SCOPE_QUESTION,
		)
		return {
			label: sample.request,
			expected: sample.expected,
			actual: decideScope(answer),
			answer,
		}
	}),
)
for (const [stage, results] of [
	['request', requestResults],
	['scope', scopeResults],
] as const) {
	const missed = results.filter(result => result.actual !== result.expected)
	for (const result of missed) {
		console.log(
			`${stage}: ${result.expected} -> ${result.actual} (${result.answer.confidence.toFixed(2)}, ${JSON.stringify(result.answer.probabilities)}): ${result.label}`,
		)
	}
	console.log(
		`${stage}: ${results.length - missed.length}/${results.length} matched; ${missed.length} mismatches; $${results.reduce((sum, result) => sum + estimateUsd(result.answer.inputTokens), 0).toFixed(5)} input; median ${results.map(result => result.answer.latencyMs).sort((a, b) => a - b)[Math.floor(results.length / 2)]}ms`,
	)
	if (missed.length) process.exitCode = 1
}
